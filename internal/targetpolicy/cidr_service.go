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

// CIDRService owns the CIDR resource without adding process-level caches.
type CIDRService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewCIDRService binds the existing identity, version and audit queries.
func NewCIDRService(pool *pgxpool.Pool) *CIDRService {
	return &CIDRService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup refuses missing or corrupt policy before the server starts.
func (s *CIDRService) ValidateStartup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, CIDRKey)
	if err != nil {
		return err
	}
	_, err = storedCIDRSettings(row)
	return err
}

// Get rechecks the database identity and both grants in one bounded snapshot.
func (s *CIDRService) Get(ctx context.Context, actor auth.CurrentUser) (CIDRSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return CIDRSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result CIDRSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		grants, err := q.GetTargetPolicyAdmin(ctx, id)
		if err := authorizeAdmin(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, CIDRKey)
		if err != nil {
			return err
		}
		result, err = storedCIDRSettings(row)
		return err
	})
	if err != nil {
		return CIDRSettings{}, err
	}
	return result, nil
}

// Update takes the common exclusive gate before identity locks, CAS before no-op,
// and commits the replacement and key-only audit in the same transaction.
func (s *CIDRService) Update(ctx context.Context, actor auth.CurrentUser, input CIDRUpdateInput) (CIDRSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return CIDRSettings{}, err
	}
	prefixes, err := normalizeCIDRs(input.Prefixes)
	if err != nil {
		return CIDRSettings{}, err
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return CIDRSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result CIDRSettings
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
		row, err := q.GetSystemSettingForUpdate(ctx, CIDRKey)
		if err != nil {
			return err
		}
		current, err := storedCIDRSettings(row)
		if err != nil {
			return err
		}
		if !row.UpdatedAt.Time.Equal(expected) {
			return ErrConflict
		}
		if slices.Equal(current.Prefixes, prefixes) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			Prefixes []string `json:"prefixes"`
		}{prefixes})
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(row.UpdatedAt.Time) {
			next = row.UpdatedAt.Time.Add(time.Microsecond)
		}
		row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: CIDRKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
		if err != nil {
			return err
		}
		result, err = storedCIDRSettings(row)
		return err
	})
	if err != nil {
		return CIDRSettings{}, err
	}
	return result, nil
}
