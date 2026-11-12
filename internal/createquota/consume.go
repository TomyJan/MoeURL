package createquota

import (
	"context"
	"math"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// Consume belongs to the already-authorized caller's gate-holding creation
// transaction. Even unlimited policy records usage; failures must roll it back.
func Consume(ctx context.Context, q *sqlc.Queries, actorID pgtype.UUID, count int) error {
	if count < 1 || count > 20 {
		return ErrInvalidInput
	}
	row, err := q.GetSystemSetting(ctx, Key)
	if err != nil {
		return err
	}
	settings, err := storedSettings(row)
	if err != nil {
		return err
	}
	if err := q.EnsureAccountDailyCreateUsage(ctx, actorID); err != nil {
		return err
	}
	usage, err := q.LockAccountDailyCreateUsage(ctx, actorID)
	if err != nil {
		return err
	}
	// clock_timestamp is deliberately queried after acquiring the usage row.
	day, err := q.GetAccountDailyCreateQuotaDay(ctx)
	if err != nil {
		return err
	}
	used, err := nextCount(usage, day, count, settings.DailyLimit)
	if err != nil {
		return err
	}
	return q.SetAccountDailyCreateUsage(ctx, sqlc.SetAccountDailyCreateUsageParams{ActorID: actorID, UsageDay: day, Used: used})
}

// nextCount never rolls the ledger back in time or lets integer overflow wrap.
func nextCount(usage sqlc.LockAccountDailyCreateUsageRow, day pgtype.Date, count int, limit *int64) (int64, error) {
	if !finiteDay(day) || !finiteDay(usage.UsageDay) || usage.Used < 0 || usage.UsageDay.Time.After(day.Time) {
		return 0, ErrCorrupt
	}
	used := usage.Used
	if usage.UsageDay.Time.Before(day.Time) {
		used = 0
	}
	n := int64(count)
	if used > math.MaxInt64-n {
		return 0, ErrCorrupt
	}
	if limit != nil && (used > *limit || n > *limit-used) {
		return 0, ErrExhausted
	}
	return used + n, nil
}

// finiteDay rejects infinity and dates outside the supported calendar range.
func finiteDay(day pgtype.Date) bool {
	return day.Valid && day.InfinityModifier == pgtype.Finite && day.Time.Year() >= 1 && day.Time.Year() <= 9999
}
