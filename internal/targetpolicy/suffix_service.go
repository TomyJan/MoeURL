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

// SuffixService owns only the independent administrator policy resource.
type SuffixService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewSuffixService binds SQLC without adding public fields or process caches.
func NewSuffixService(pool *pgxpool.Pool) *SuffixService {
	return &SuffixService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup fails before serving if the stored policy is absent or corrupt.
func (s *SuffixService) ValidateStartup(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, SuffixKey)
	if err != nil {
		return err
	}
	_, err = storedSuffixSettings(row)
	return err
}

// Get authorizes the current database identity in one bounded read snapshot.
func (s *SuffixService) Get(ctx context.Context, actor auth.CurrentUser) (SuffixSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return SuffixSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result SuffixSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		grants, err := q.GetTargetPolicyAdmin(ctx, id)
		if err := authorizeAdmin(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, SuffixKey)
		if err != nil {
			return err
		}
		result, err = storedSuffixSettings(row)
		return err
	})
	if err != nil {
		return SuffixSettings{}, err
	}
	return result, nil
}

// Update takes the exclusive gate before identity locks, then checks CAS before
// no-op. Changes and key-only audit either both commit or both roll back.
func (s *SuffixService) Update(ctx context.Context, actor auth.CurrentUser, input SuffixUpdateInput) (SuffixSettings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return SuffixSettings{}, err
	}
	hosts, err := normalizeHosts(input.Suffixes)
	if err != nil {
		return SuffixSettings{}, err
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return SuffixSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result SuffixSettings
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
		row, err := q.GetSystemSettingForUpdate(ctx, SuffixKey)
		if err != nil {
			return err
		}
		current, err := storedSuffixSettings(row)
		if err != nil {
			return err
		}
		if !row.UpdatedAt.Time.Equal(expected) {
			return ErrConflict
		}
		if slices.Equal(current.Suffixes, hosts) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			Suffixes []string `json:"suffixes"`
		}{hosts})
		next := time.Now().UTC().Truncate(time.Microsecond)
		if !next.After(row.UpdatedAt.Time) {
			next = row.UpdatedAt.Time.Add(time.Microsecond)
		}
		row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: SuffixKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
		if err != nil {
			return err
		}
		result, err = storedSuffixSettings(row)
		return err
	})
	if err != nil {
		return SuffixSettings{}, err
	}
	return result, nil
}
