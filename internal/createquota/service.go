package createquota

import (
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

// Service manages the independent quota policy and self usage reads without a process cache.
type Service struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewService binds the existing SQLC and audit transaction infrastructure.
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, queries: sqlc.New(pool)} }

// ValidateStartup rejects missing or corrupt policy before serving requests.
func (s *Service) ValidateStartup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, Key)
	if err != nil {
		return err
	}
	_, err = storedSettings(row)
	return err
}

// Get checks current database identity and grants in a bounded read snapshot.
func (s *Service) Get(ctx context.Context, actor auth.CurrentUser) (Settings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return Settings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result Settings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		raw, err := q.GetCreateQuotaAdmin(ctx, id)
		if err := authorizeAdmin(raw, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, Key)
		if err != nil {
			return err
		}
		result, err = storedSettings(row)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return result, nil
}

// Update takes the exclusive gate before identity and setting locks. Stale
// no-ops conflict; effective changes and the key-only audit commit together.
func (s *Service) Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (Settings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return Settings{}, err
	}
	if !validLimit(input.DailyLimit) {
		return Settings{}, ErrInvalidInput
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return Settings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result Settings
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := lockUpdate(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		group, err := q.LockCreateQuotaActor(ctx, id)
		if err != nil {
			return identityError(err)
		}
		raw, err := q.LockCreateQuotaAdminGroup(ctx, group)
		if err := authorizeAdmin(raw, err); err != nil {
			return err
		}
		row, err := q.GetSystemSettingForUpdate(ctx, Key)
		if err != nil {
			return err
		}
		current, err := storedSettings(row)
		if err != nil {
			return err
		}
		if !row.UpdatedAt.Time.Equal(expected) {
			return ErrConflict
		}
		if sameLimit(current.DailyLimit, input.DailyLimit) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			DailyLimit *int64 `json:"dailyLimit"`
		}{input.DailyLimit})
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(row.UpdatedAt.Time) {
			next = row.UpdatedAt.Time.Add(time.Microsecond)
		}
		row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: Key, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
		if err != nil {
			return err
		}
		result, err = storedSettings(row)
		return err
	})
	if err != nil {
		return Settings{}, err
	}
	return result, nil
}

// sameLimit distinguishes an explicit zero budget from disabled enforcement.
func sameLimit(a, b *int64) bool { return a == nil && b == nil || a != nil && b != nil && *a == *b }

// actorID rejects guest markers and noncanonical identifiers before database I/O.
func actorID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// identityError hides missing, disabled and deleted management identities.
func identityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPermissionDenied
	}
	return err
}

// authorizeAdmin reads both grants from the current database snapshot.
func authorizeAdmin(raw []byte, err error) error {
	if err != nil {
		return identityError(err)
	}
	grants, err := permission.DecodeSnapshot(raw)
	if err != nil {
		return ErrCorrupt
	}
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.SystemManage) {
		return ErrPermissionDenied
	}
	return nil
}
