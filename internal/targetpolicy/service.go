package targetpolicy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"slices"
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

// Service owns only the independent administrator policy resource.
type Service struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

// NewService binds SQLC without adding public fields or process caches.
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool, queries: sqlc.New(pool)} }

// ValidateStartup fails before serving if the stored policy is absent or corrupt.
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

// Get authorizes the current database identity in one bounded read snapshot.
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
		grants, err := q.GetTargetPolicyAdmin(ctx, id)
		if err := authorizeAdmin(grants, err); err != nil {
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

// Update takes the exclusive gate before identity locks, then checks CAS before
// no-op. Changes and key-only audit either both commit or both roll back.
func (s *Service) Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (Settings, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return Settings{}, err
	}
	hosts, err := normalizeHosts(input.Hosts)
	if err != nil {
		return Settings{}, err
	}
	expected, err := parseVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return Settings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result Settings
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
		if slices.Equal(current.Hosts, hosts) {
			result = current
			return nil
		}
		value, _ := json.Marshal(struct {
			Hosts []string `json:"hosts"`
		}{hosts})
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

// CheckTargets validates all five resources in the caller's gate-holding
// transaction, then applies denials before the union of enabled allow rules.
func CheckTargets(ctx context.Context, q *sqlc.Queries, targets []string) error {
	row, err := q.GetSystemSetting(ctx, Key)
	if err != nil {
		return err
	}
	settings, err := storedSettings(row)
	if err != nil {
		return err
	}
	allowlistRow, err := q.GetSystemSetting(ctx, AllowlistKey)
	if err != nil {
		return err
	}
	allowlist, err := storedAllowlistSettings(allowlistRow)
	if err != nil {
		return err
	}
	suffixRow, err := q.GetSystemSetting(ctx, SuffixKey)
	if err != nil {
		return err
	}
	suffix, err := storedSuffixSettings(suffixRow)
	if err != nil {
		return err
	}
	suffixAllowlistRow, err := q.GetSystemSetting(ctx, SuffixAllowlistKey)
	if err != nil {
		return err
	}
	suffixAllowlist, err := storedSuffixAllowlistSettings(suffixAllowlistRow)
	if err != nil {
		return err
	}
	ipRow, err := q.GetSystemSetting(ctx, IPKey)
	if err != nil {
		return err
	}
	ipSettings, err := storedIPSettings(ipRow)
	if err != nil {
		return err
	}
	if err := checkIPs(ipSettings.Addresses, targets); err != nil {
		return err
	}
	if err := checkHosts(settings.Hosts, targets); err != nil {
		return err
	}
	if err := checkSuffixes(suffix.Suffixes, targets); err != nil {
		return err
	}
	return checkAllowlistTargets(allowlist, suffixAllowlist, targets)
}

// actorID accepts only a canonical nonzero UUID; guest markers never reach I/O.
func actorID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// identityError hides absent, disabled, deleted and non-administrator identities.
func identityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPermissionDenied
	}
	return err
}

// authorizeAdmin requires both current grants and rejects corrupt snapshots.
func authorizeAdmin(raw []byte, err error) error {
	if err != nil {
		return identityError(err)
	}
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || trimmed[0] != '[' {
		return ErrCorrupt
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
