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

// CIDRAllowlistService owns the optional resource without caching either policy.
type CIDRAllowlistService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewCIDRAllowlistService reuses the existing setting and current-identity queries.
func NewCIDRAllowlistService(pool *pgxpool.Pool) *CIDRAllowlistService {
	return &CIDRAllowlistService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup fails before serving on absent or noncanonical configuration.
func (s *CIDRAllowlistService) ValidateStartup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, CIDRAllowlistKey)
	if err != nil {
		return err
	}
	_, err = storedCIDRAllowlistSettings(row)
	return err
}

// Get reads only after current database identity and both grants are confirmed.
func (s *CIDRAllowlistService) Get(ctx context.Context, actor auth.CurrentUser) (CIDRAllowlistSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return CIDRAllowlistSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result CIDRAllowlistSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		grants, err := q.GetTargetPolicyAdmin(ctx, id)
		if err := authorizeAdmin(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, CIDRAllowlistKey)
		if err != nil {
			return err
		}
		result, err = storedCIDRAllowlistSettings(row)
		return err
	})
	if err != nil {
		return CIDRAllowlistSettings{}, err
	}
	return result, nil
}

// Update shares the denylist's exclusive gate before identity and setting locks;
// CAS precedes no-op, and the key-only audit commits with the replacement.
func (s *CIDRAllowlistService) Update(ctx context.Context, actor auth.CurrentUser, input CIDRAllowlistUpdateInput) (CIDRAllowlistSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return CIDRAllowlistSettings{}, err
	}
	prefixes, err := normalizeCIDRs(input.Prefixes)
	if err != nil || input.Enabled && len(prefixes) == 0 {
		return CIDRAllowlistSettings{}, ErrInvalidInput
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return CIDRAllowlistSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result CIDRAllowlistSettings
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
		row, err := q.GetSystemSettingForUpdate(ctx, CIDRAllowlistKey)
		if err != nil {
			return err
		}
		current, err := storedCIDRAllowlistSettings(row)
		if err != nil {
			return err
		}
		if !row.UpdatedAt.Time.Equal(expected) {
			return ErrConflict
		}
		if current.Enabled == input.Enabled && slices.Equal(current.Prefixes, prefixes) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			Enabled  bool     `json:"enabled"`
			Prefixes []string `json:"prefixes"`
		}{input.Enabled, prefixes})
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(row.UpdatedAt.Time) {
			next = row.UpdatedAt.Time.Add(time.Microsecond)
		}
		row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: CIDRAllowlistKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
		if err != nil {
			return err
		}
		result, err = storedCIDRAllowlistSettings(row)
		return err
	})
	if err != nil {
		return CIDRAllowlistSettings{}, err
	}
	return result, nil
}
