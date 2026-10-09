package system

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	settingSiteName          = "site.name"
	settingDefaultLanguage   = "site.default_language"
	settingDefaultTheme      = "site.default_theme"
	settingFooterText        = "site.footer_text"
	settingShowPoweredBy     = "site.show_powered_by"
	settingLocalLoginEnabled = "auth.local_login_enabled"
	settingRevision          = "site.settings_revision"
)

var editableSettingKeys = []string{
	settingSiteName, settingDefaultLanguage, settingDefaultTheme, settingFooterText,
	settingShowPoweredBy, settingLocalLoginEnabled, settingRevision,
}

// SettingsLoginPolicy coordinates login-entry locks with settings updates.
type SettingsLoginPolicy interface {
	LockLocalLogin(context.Context, pgx.Tx) (bool, error)
	RequireAvailableProvider(context.Context, pgx.Tx) error
}

// SettingsService manages public and administrative site settings.
type SettingsService struct {
	pool        *pgxpool.Pool
	queries     *sqlc.Queries
	permissions permission.Resolver
	loginPolicy SettingsLoginPolicy
}

// NewSettingsService creates a transactional settings service.
func NewSettingsService(pool *pgxpool.Pool, permissions permission.Resolver, loginPolicy SettingsLoginPolicy) *SettingsService {
	return &SettingsService{pool: pool, queries: sqlc.New(pool), permissions: permissions, loginPolicy: loginPolicy}
}

// PublicConfig returns only settings safe to expose before authentication.
func (s *SettingsService) PublicConfig(ctx context.Context) (PublicConfig, error) {
	settings, err := s.readSettings(ctx, s.queries)
	return settings.PublicConfig, err
}

// GetSettings returns the complete settings view to authorized administrators.
func (s *SettingsService) GetSettings(ctx context.Context, actor auth.CurrentUser) (Settings, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return Settings{}, err
	}
	return s.readSettings(ctx, s.queries)
}

// UpdateSettings validates and atomically replaces the editable settings collection.
func (s *SettingsService) UpdateSettings(ctx context.Context, actor auth.CurrentUser, input UpdateSettingsInput) (Settings, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return Settings{}, err
	}
	normalized, expected, err := normalizeSettingsInput(input)
	if err != nil {
		return Settings{}, err
	}
	var result Settings
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		if s.loginPolicy == nil {
			return errors.New("login policy unavailable")
		}
		if _, err := s.loginPolicy.LockLocalLogin(ctx, tx); err != nil {
			return err
		}
		queries := s.queries.WithTx(tx)
		revision, err := queries.GetSystemSettingForUpdate(ctx, settingRevision)
		if err != nil {
			return err
		}
		if !revision.UpdatedAt.Time.UTC().Equal(expected) {
			return ErrSettingsConflict
		}
		if !normalized.LocalLoginEnabled {
			if err := s.loginPolicy.RequireAvailableProvider(ctx, tx); err != nil {
				return fmt.Errorf("%w: %w", ErrNoLoginProvider, err)
			}
		}
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(revision.UpdatedAt.Time) {
			next = revision.UpdatedAt.Time.Add(time.Microsecond)
		}
		values := map[string]any{
			settingSiteName: normalized.SiteName, settingDefaultLanguage: normalized.DefaultLanguage,
			settingDefaultTheme: normalized.DefaultTheme, settingFooterText: normalized.FooterText,
			settingShowPoweredBy: normalized.ShowPoweredBy, settingLocalLoginEnabled: normalized.LocalLoginEnabled,
			settingRevision: 1,
		}
		var persistedRevision time.Time
		for _, key := range editableSettingKeys {
			value, _ := json.Marshal(values[key])
			updated, updateErr := queries.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{
				Key: key, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true},
			})
			if updateErr != nil {
				return updateErr
			}
			if key == settingRevision {
				persistedRevision = updated.UpdatedAt.Time.UTC()
			}
		}
		result = Settings{PublicConfig: PublicConfig{
			SiteName: normalized.SiteName, DefaultLanguage: normalized.DefaultLanguage,
			DefaultTheme: normalized.DefaultTheme, FooterText: normalized.FooterText,
			ShowPoweredBy: normalized.ShowPoweredBy,
		}, LocalLoginEnabled: normalized.LocalLoginEnabled, UpdatedAt: persistedRevision.Format(time.RFC3339Nano)}
		return nil
	})
	return result, err
}

func (s *SettingsService) authorize(ctx context.Context, actor auth.CurrentUser) error {
	if s.permissions == nil {
		return ErrSettingsPermissionDenied
	}
	snapshot, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return err
	}
	if !snapshot.Has(permission.AdminAccess) || !snapshot.Has(permission.SystemManage) {
		return ErrSettingsPermissionDenied
	}
	return nil
}

type settingsQuery interface {
	ListSystemSettings(context.Context, []string) ([]sqlc.SystemSetting, error)
}

func (s *SettingsService) readSettings(ctx context.Context, queries settingsQuery) (Settings, error) {
	rows, err := queries.ListSystemSettings(ctx, editableSettingKeys)
	if err != nil {
		return Settings{}, err
	}
	if len(rows) != len(editableSettingKeys) {
		return Settings{}, ErrCorruptSettings
	}
	result := Settings{PublicConfig: PublicConfig{
		SiteName: "MoeURL", DefaultLanguage: "zh-CN", DefaultTheme: "system", ShowPoweredBy: true,
	}, LocalLoginEnabled: true}
	for _, row := range rows {
		switch row.Key {
		case settingSiteName:
			err = decodeRequiredSetting(row.Value, &result.SiteName)
		case settingDefaultLanguage:
			err = decodeRequiredSetting(row.Value, &result.DefaultLanguage)
		case settingDefaultTheme:
			err = decodeRequiredSetting(row.Value, &result.DefaultTheme)
		case settingFooterText:
			err = decodeRequiredSetting(row.Value, &result.FooterText)
		case settingShowPoweredBy:
			err = decodeRequiredSetting(row.Value, &result.ShowPoweredBy)
		case settingLocalLoginEnabled:
			err = decodeRequiredSetting(row.Value, &result.LocalLoginEnabled)
		case settingRevision:
			var revision int
			err = decodeRequiredSetting(row.Value, &revision)
			if err == nil && revision < 1 {
				err = ErrCorruptSettings
			}
			result.UpdatedAt = row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)
		}
		if err != nil {
			return Settings{}, ErrCorruptSettings
		}
	}
	if !validPersistedSettings(result) {
		return Settings{}, ErrCorruptSettings
	}
	return result, nil
}

// decodeRequiredSetting rejects JSON null and values whose type does not match the setting schema.
func decodeRequiredSetting[T any](value []byte, destination *T) error {
	var decoded *T
	if err := json.Unmarshal(value, &decoded); err != nil || decoded == nil {
		return ErrCorruptSettings
	}
	*destination = *decoded
	return nil
}

// validPersistedSettings applies the public constraints and canonical string form to stored values.
func validPersistedSettings(settings Settings) bool {
	normalized, _, err := normalizeSettingsInput(UpdateSettingsInput{
		SiteName: settings.SiteName, DefaultLanguage: settings.DefaultLanguage, DefaultTheme: settings.DefaultTheme,
		FooterText: settings.FooterText, ShowPoweredBy: settings.ShowPoweredBy,
		LocalLoginEnabled: settings.LocalLoginEnabled, ExpectedUpdatedAt: settings.UpdatedAt,
	})
	return err == nil && normalized.SiteName == settings.SiteName && normalized.FooterText == settings.FooterText
}

func normalizeSettingsInput(input UpdateSettingsInput) (UpdateSettingsInput, time.Time, error) {
	input.SiteName = strings.TrimSpace(input.SiteName)
	input.FooterText = strings.TrimSpace(input.FooterText)
	if count := utf8.RuneCountInString(input.SiteName); count < 1 || count > 64 {
		return UpdateSettingsInput{}, time.Time{}, ErrInvalidSettings
	}
	if utf8.RuneCountInString(input.FooterText) > 200 {
		return UpdateSettingsInput{}, time.Time{}, ErrInvalidSettings
	}
	if input.DefaultLanguage != "zh-CN" && input.DefaultLanguage != "en" {
		return UpdateSettingsInput{}, time.Time{}, ErrInvalidSettings
	}
	if input.DefaultTheme != "system" && input.DefaultTheme != "light" && input.DefaultTheme != "dark" {
		return UpdateSettingsInput{}, time.Time{}, ErrInvalidSettings
	}
	expected, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil {
		return UpdateSettingsInput{}, time.Time{}, ErrInvalidSettings
	}
	return input, expected.UTC(), nil
}
