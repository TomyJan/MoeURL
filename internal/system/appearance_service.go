package system

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AppearanceService owns only the independent site accent resource.
type AppearanceService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewAppearanceService preserves all legacy general-settings contracts.
func NewAppearanceService(pool *pgxpool.Pool) *AppearanceService {
	return &AppearanceService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup refuses missing or corrupt saved accent before serving it.
func (s *AppearanceService) ValidateStartup(ctx context.Context) error {
	_, err := s.PublicAppearance(ctx)
	return err
}

// PublicAppearance projects just the public preset with bounded I/O.
func (s *AppearanceService) PublicAppearance(ctx context.Context) (Appearance, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, appearanceKey)
	if err != nil {
		return Appearance{}, err
	}
	stored, err := storedAppearance(row)
	return stored.Appearance, err
}

// GetAppearance authorizes and reads from one bounded current database snapshot.
func (s *AppearanceService) GetAppearance(ctx context.Context, actor auth.CurrentUser) (AppearanceSettings, error) {
	id, err := appearanceActorID(actor.ID)
	if err != nil {
		return AppearanceSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result AppearanceSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		permissions, err := q.GetAppearanceActor(ctx, id)
		if err := authorizeAppearancePermissions(permissions, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, appearanceKey)
		if err != nil {
			return err
		}
		result, err = storedAppearance(row)
		return err
	})
	if err != nil {
		return AppearanceSettings{}, err
	}
	return result, nil
}

type appearanceWriteStore interface {
	LockAppearanceActor(context.Context, pgtype.UUID) (pgtype.UUID, error)
	LockAppearanceGroup(context.Context, pgtype.UUID) ([]byte, error)
	GetSystemSettingForUpdate(context.Context, string) (sqlc.SystemSetting, error)
	UpdateSystemSettingValue(context.Context, sqlc.UpdateSystemSettingValueParams) (sqlc.SystemSetting, error)
}

// UpdateAppearance rechecks current authority inside the audit transaction and
// compares the revision before recognizing a no-op, so stale commands conflict.
func (s *AppearanceService) UpdateAppearance(ctx context.Context, actor auth.CurrentUser, input UpdateAppearanceInput) (AppearanceSettings, error) {
	id, err := appearanceActorID(actor.ID)
	if err != nil {
		return AppearanceSettings{}, err
	}
	content, err := normalizeAppearance(input.AccentPreset)
	if err != nil {
		return AppearanceSettings{}, err
	}
	expected, err := appearanceVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return AppearanceSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result AppearanceSettings
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		var err error
		result, err = applyAppearance(ctx, s.queries.WithTx(tx), id, content, expected)
		return err
	})
	if err != nil {
		return AppearanceSettings{}, err
	}
	return result, nil
}

// applyAppearance locks actor, current group, then the content row. A completed
// revocation cannot be bypassed using the caller's cached role or permissions.
func applyAppearance(ctx context.Context, q appearanceWriteStore, id pgtype.UUID, content Appearance, expected time.Time) (AppearanceSettings, error) {
	group, err := q.LockAppearanceActor(ctx, id)
	if err != nil {
		return AppearanceSettings{}, appearanceIdentityError(err)
	}
	permissions, err := q.LockAppearanceGroup(ctx, group)
	if err := authorizeAppearancePermissions(permissions, err); err != nil {
		return AppearanceSettings{}, err
	}
	row, err := q.GetSystemSettingForUpdate(ctx, appearanceKey)
	if err != nil {
		return AppearanceSettings{}, err
	}
	current, err := storedAppearance(row)
	if err != nil {
		return AppearanceSettings{}, err
	}
	if !row.UpdatedAt.Time.Equal(expected) {
		return AppearanceSettings{}, ErrAppearanceConflict
	}
	if current.Appearance == content {
		return current, nil
	}
	value, _ := json.Marshal(content) // The preset string cannot fail JSON encoding.
	next := time.Now().UTC().Truncate(time.Microsecond)
	if !next.After(row.UpdatedAt.Time) {
		next = row.UpdatedAt.Time.Add(time.Microsecond)
	}
	row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: appearanceKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
	if err != nil {
		return AppearanceSettings{}, err
	}
	return storedAppearance(row)
}

// appearanceActorID rejects guests and ambiguous UUID spellings before I/O.
func appearanceActorID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrSettingsPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// appearanceIdentityError maps absent/disabled/deleted identities to denial.
func appearanceIdentityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSettingsPermissionDenied
	}
	return err
}

// authorizeAppearancePermissions treats a corrupt non-array as infrastructure
// failure and requires both current management capabilities, never role alone.
func authorizeAppearancePermissions(raw []byte, err error) error {
	if err != nil {
		return appearanceIdentityError(err)
	}
	if value := bytes.TrimSpace(raw); len(value) == 0 || value[0] != '[' {
		return ErrCorruptAppearance
	}
	grants, err := permission.DecodeSnapshot(raw)
	if err != nil {
		return ErrCorruptAppearance
	}
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.SystemManage) {
		return ErrSettingsPermissionDenied
	}
	return nil
}
