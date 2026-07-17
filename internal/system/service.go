package system

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const initializedSettingKey = "site.initialized"

type Service struct {
	pool *pgxpool.Pool
}

// NewService creates the system-initialization service.
func NewService(pool *pgxpool.Pool) *Service {
	return &Service{pool: pool}
}

// IsInitialized reports whether the initial administrator account exists.
func (s *Service) IsInitialized(ctx context.Context) (bool, error) {
	var initialized bool
	err := s.pool.QueryRow(ctx, `
		select coalesce((value)::boolean, false)
		from system_setting
		where key = $1
	`, initializedSettingKey).Scan(&initialized)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return initialized, nil
}

// Setup creates the initial groups, administrator, domain, and settings once.
func (s *Service) Setup(ctx context.Context, input SetupInput) error {
	if err := validateSetupInput(input); err != nil {
		return err
	}

	initialized, err := s.IsInitialized(ctx)
	if err != nil {
		return err
	}
	if initialized {
		return ErrAlreadyInitialized
	}

	passwordHash, err := auth.HashPassword(input.AdminPassword)
	if err != nil {
		return err
	}

	return appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		guestGroupID := uuid.New()
		userGroupID := uuid.New()
		adminGroupID := uuid.New()

		if err := insertGroup(ctx, tx, guestGroupID, "guest", "Guest", "Built-in guest group", []string{}, now); err != nil {
			return err
		}
		if err := insertGroup(ctx, tx, userGroupID, "user", "User", "Built-in user group", permission.UserPermissions, now); err != nil {
			return err
		}
		if err := insertGroup(ctx, tx, adminGroupID, "admin", "Admin", "Built-in admin group", permission.AdminPermissions, now); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
			values ($1, 'guest', null, 'Guest', $2, 'active', true, $3, $3)
		`, uuid.New(), guestGroupID, now); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
			values ($1, $2, $3, $4, $5, 'active', false, $6, $6)
		`, uuid.New(), strings.TrimSpace(input.AdminUsername), passwordHash, strings.TrimSpace(input.AdminNickname), adminGroupID, now); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
			values ($1, $2, $2, 'short_link', true, true, $3, $3)
		`, uuid.New(), strings.TrimSpace(input.ShortLinkDomain), now); err != nil {
			return err
		}

		settings := map[string]any{
			"site.name":                      strings.TrimSpace(input.SiteName),
			"site.initialized":               true,
			"site.system_domain":             strings.TrimSpace(input.SystemDomain),
			"site.default_short_link_domain": strings.TrimSpace(input.ShortLinkDomain),
			"site.default_language":          strings.TrimSpace(input.DefaultLanguage),
			"site.default_theme":             strings.TrimSpace(input.DefaultTheme),
		}
		for key, value := range settings {
			if err := upsertSetting(ctx, tx, key, value, now); err != nil {
				return err
			}
		}

		return nil
	})
}

// validateSetupInput verifies the required initial-system setup fields.
func validateSetupInput(input SetupInput) error {
	required := []string{
		input.AdminUsername,
		input.AdminPassword,
		input.AdminNickname,
		input.SiteName,
		input.SystemDomain,
		input.ShortLinkDomain,
		input.DefaultLanguage,
		input.DefaultTheme,
	}
	for _, value := range required {
		if strings.TrimSpace(value) == "" {
			return ErrInvalidSetupInput
		}
	}
	adminUsername := strings.ToLower(strings.TrimSpace(input.AdminUsername))
	if adminUsername == "guest" {
		return ErrInvalidSetupInput
	}
	return nil
}

// insertGroup inserts an initial user group and its permissions.
func insertGroup(ctx context.Context, tx pgx.Tx, id uuid.UUID, key string, name string, description string, permissions []string, now time.Time) error {
	permissionsJSON, err := json.Marshal(permissions)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ($1, $2, $3, $4, $5::jsonb, true, $6, $6)
	`, id, key, name, description, permissionsJSON, now)
	return err
}

// upsertSetting inserts or updates a system setting in the transaction.
func upsertSetting(ctx context.Context, tx pgx.Tx, key string, value any, now time.Time) error {
	valueJSON, err := json.Marshal(value)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into system_setting (key, value, created_at, updated_at)
		values ($1, $2::jsonb, $3, $3)
		on conflict (key) do update
		set value = excluded.value,
			updated_at = excluded.updated_at
	`, key, valueJSON, now)
	return err
}
