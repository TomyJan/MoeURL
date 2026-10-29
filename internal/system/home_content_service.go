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

// HomeContentService owns only the independent homepage content resource.
type HomeContentService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewHomeContentService preserves all legacy general-settings contracts.
func NewHomeContentService(pool *pgxpool.Pool) *HomeContentService {
	return &HomeContentService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup refuses missing or corrupt saved content before serving it.
func (s *HomeContentService) ValidateStartup(ctx context.Context) error {
	_, err := s.PublicHomeContent(ctx)
	return err
}

// PublicHomeContent projects just the two public strings with bounded I/O.
func (s *HomeContentService) PublicHomeContent(ctx context.Context) (HomeContent, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, homeContentKey)
	if err != nil {
		return HomeContent{}, err
	}
	stored, err := storedHomeContent(row)
	return stored.HomeContent, err
}

// GetHomeContent authorizes and reads from one bounded current database snapshot.
func (s *HomeContentService) GetHomeContent(ctx context.Context, actor auth.CurrentUser) (HomeContentSettings, error) {
	id, err := homeContentActorID(actor.ID)
	if err != nil {
		return HomeContentSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result HomeContentSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		permissions, err := q.GetHomeContentActor(ctx, id)
		if err := authorizeHomeContentPermissions(permissions, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, homeContentKey)
		if err != nil {
			return err
		}
		result, err = storedHomeContent(row)
		return err
	})
	if err != nil {
		return HomeContentSettings{}, err
	}
	return result, nil
}

type homeContentWriteStore interface {
	LockHomeContentActor(context.Context, pgtype.UUID) (pgtype.UUID, error)
	LockHomeContentGroup(context.Context, pgtype.UUID) ([]byte, error)
	GetSystemSettingForUpdate(context.Context, string) (sqlc.SystemSetting, error)
	UpdateSystemSettingValue(context.Context, sqlc.UpdateSystemSettingValueParams) (sqlc.SystemSetting, error)
}

// UpdateHomeContent rechecks current authority inside the audit transaction and
// compares the revision before recognizing a no-op, so stale commands conflict.
func (s *HomeContentService) UpdateHomeContent(ctx context.Context, actor auth.CurrentUser, input UpdateHomeContentInput) (HomeContentSettings, error) {
	id, err := homeContentActorID(actor.ID)
	if err != nil {
		return HomeContentSettings{}, err
	}
	content, err := normalizeHomeContent(input.Title, input.Summary)
	if err != nil {
		return HomeContentSettings{}, err
	}
	expected, err := homeContentVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return HomeContentSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result HomeContentSettings
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		var err error
		result, err = applyHomeContent(ctx, s.queries.WithTx(tx), id, content, expected)
		return err
	})
	if err != nil {
		return HomeContentSettings{}, err
	}
	return result, nil
}

// applyHomeContent locks actor, current group, then the content row. A completed
// revocation cannot be bypassed using the caller's cached role or permissions.
func applyHomeContent(ctx context.Context, q homeContentWriteStore, id pgtype.UUID, content HomeContent, expected time.Time) (HomeContentSettings, error) {
	group, err := q.LockHomeContentActor(ctx, id)
	if err != nil {
		return HomeContentSettings{}, homeContentIdentityError(err)
	}
	permissions, err := q.LockHomeContentGroup(ctx, group)
	if err := authorizeHomeContentPermissions(permissions, err); err != nil {
		return HomeContentSettings{}, err
	}
	row, err := q.GetSystemSettingForUpdate(ctx, homeContentKey)
	if err != nil {
		return HomeContentSettings{}, err
	}
	current, err := storedHomeContent(row)
	if err != nil {
		return HomeContentSettings{}, err
	}
	if !row.UpdatedAt.Time.Equal(expected) {
		return HomeContentSettings{}, ErrHomeContentConflict
	}
	if current.HomeContent == content {
		return current, nil
	}
	value, _ := json.Marshal(content) // The two string fields cannot fail JSON encoding.
	next := time.Now().UTC().Truncate(time.Microsecond)
	if !next.After(row.UpdatedAt.Time) {
		next = row.UpdatedAt.Time.Add(time.Microsecond)
	}
	row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: homeContentKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
	if err != nil {
		return HomeContentSettings{}, err
	}
	return storedHomeContent(row)
}

// homeContentActorID rejects guests and ambiguous UUID spellings before I/O.
func homeContentActorID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrSettingsPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// homeContentIdentityError maps absent/disabled/deleted identities to denial.
func homeContentIdentityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSettingsPermissionDenied
	}
	return err
}

// authorizeHomeContentPermissions treats a corrupt non-array as infrastructure
// failure and requires both current management capabilities, never role alone.
func authorizeHomeContentPermissions(raw []byte, err error) error {
	if err != nil {
		return homeContentIdentityError(err)
	}
	if value := bytes.TrimSpace(raw); len(value) == 0 || value[0] != '[' {
		return ErrCorruptHomeContent
	}
	grants, err := permission.DecodeSnapshot(raw)
	if err != nil {
		return ErrCorruptHomeContent
	}
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.SystemManage) {
		return ErrSettingsPermissionDenied
	}
	return nil
}
