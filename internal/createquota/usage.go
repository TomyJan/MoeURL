package createquota

import (
	"context"
	"strconv"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

// Usage is the current owner's UTC-day snapshot, never a creation authorization.
// Used stays a decimal string so browser consumers preserve all int64 digits.
type Usage struct {
	UsageDay   string `json:"usageDay"`
	Used       string `json:"used"`
	DailyLimit *int64 `json:"dailyLimit"`
	Remaining  *int64 `json:"remaining"`
}

// UsagePort keeps self reads separate from administrator policy replacements.
type UsagePort interface {
	GetOwnUsage(context.Context, auth.CurrentUser) (Usage, error)
}

// GetOwnUsage reads one bounded database snapshot without locking or creating a
// meter. Current database identity and grants, not caller claims, authorize it.
func (s *Service) GetOwnUsage(ctx context.Context, actor auth.CurrentUser) (Usage, error) {
	id, err := actorID(actor.ID)
	if err != nil {
		return Usage{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result Usage
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		raw, err := q.GetCreateQuotaReader(ctx, id)
		if err != nil {
			return identityError(err)
		}
		grants, err := permission.DecodeSnapshot(raw)
		if err != nil {
			return ErrCorrupt
		}
		if !grants.Has(permission.ShortLinkCreate) {
			return ErrPermissionDenied
		}
		policy, err := q.GetSystemSetting(ctx, Key)
		if err != nil {
			return err
		}
		settings, err := storedSettings(policy)
		if err != nil {
			return err
		}
		row, err := q.GetAccountDailyCreateUsage(ctx, id)
		if err != nil {
			return err
		}
		result, err = usageSnapshot(row, settings.DailyLimit)
		return err
	})
	if err != nil {
		return Usage{}, err
	}
	return result, nil
}

// usageSnapshot validates persisted values before normalizing a missing or
// historical meter. Subtraction only happens when used is below the limit.
func usageSnapshot(row sqlc.GetAccountDailyCreateUsageRow, limit *int64) (Usage, error) {
	if !finiteDay(row.QuotaDay) || !validLimit(limit) || row.Used.Valid != row.UsageDay.Valid {
		return Usage{}, ErrCorrupt
	}
	var used int64
	if row.Used.Valid {
		if !finiteDay(row.UsageDay) || row.Used.Int64 < 0 || row.UsageDay.Time.After(row.QuotaDay.Time) {
			return Usage{}, ErrCorrupt
		}
		if row.UsageDay.Time.Equal(row.QuotaDay.Time) {
			used = row.Used.Int64
		}
	}
	result := Usage{UsageDay: row.QuotaDay.Time.Format("2006-01-02"), Used: strconv.FormatInt(used, 10), DailyLimit: limit}
	if limit != nil {
		remaining := int64(0)
		if used < *limit {
			remaining = *limit - used
		}
		result.Remaining = &remaining
	}
	return result, nil
}
