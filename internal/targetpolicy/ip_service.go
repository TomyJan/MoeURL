package targetpolicy

import (
	"context"
	"encoding/json"
	"slices"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// IPService owns the literal-IP resource without adding process-level caches.
type IPService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewIPService binds the existing identity, version and audit queries.
func NewIPService(pool *pgxpool.Pool) *IPService {
	return &IPService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup refuses missing or corrupt policy before the server starts.
func (s *IPService) ValidateStartup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, IPKey)
	if err != nil {
		return err
	}
	_, err = storedIPSettings(row)
	return err
}

// Get rechecks the database identity and both grants in one bounded snapshot.
func (s *IPService) Get(ctx context.Context, actor auth.CurrentUser) (IPSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return IPSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result IPSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		grants, err := q.GetTargetPolicyAdmin(ctx, id)
		if err := authorizeAdmin(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, IPKey)
		if err != nil {
			return err
		}
		result, err = storedIPSettings(row)
		return err
	})
	if err != nil {
		return IPSettings{}, err
	}
	return result, nil
}

// Update takes the common exclusive gate before identity locks, CAS before no-op,
// and commits the replacement and key-only audit in the same transaction.
func (s *IPService) Update(ctx context.Context, actor auth.CurrentUser, input IPUpdateInput) (IPSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return IPSettings{}, err
	}
	addresses, err := normalizeIPs(input.Addresses)
	if err != nil {
		return IPSettings{}, err
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return IPSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result IPSettings
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := LockPolicyUpdate(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		group, err := q.LockTargetPolicyActor(ctx, id)
		if err != nil {
			return identityError(err)
		}
		grants, err := q.LockTargetPolicyAdminGroup(ctx, group)
		if err := authorizeAdmin(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSettingForUpdate(ctx, IPKey)
		if err != nil {
			return err
		}
		current, err := storedIPSettings(row)
		if err != nil {
			return err
		}
		if !row.UpdatedAt.Time.Equal(expected) {
			return ErrConflict
		}
		if slices.Equal(current.Addresses, addresses) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			Addresses []string `json:"addresses"`
		}{addresses})
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(row.UpdatedAt.Time) {
			next = row.UpdatedAt.Time.Add(time.Microsecond)
		}
		row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: IPKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
		if err != nil {
			return err
		}
		result, err = storedIPSettings(row)
		return err
	})
	if err != nil {
		return IPSettings{}, err
	}
	return result, nil
}
