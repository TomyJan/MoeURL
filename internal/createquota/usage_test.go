package createquota

import (
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestOwnUsageSnapshotRejectsCorruption covers unsupported dates and partially
// null joins, including a negative historical counter that must not become 0.
func TestOwnUsageSnapshotRejectsCorruption(t *testing.T) {
	day := pgtype.Date{Time: time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC), Valid: true}
	negative := int64(-1)
	for _, tc := range []struct {
		name        string
		day, stored pgtype.Date
		used        pgtype.Int8
		limit       *int64
	}{
		{"invalid today", pgtype.Date{}, pgtype.Date{}, pgtype.Int8{}, nil},
		{"infinite today", pgtype.Date{Valid: true, InfinityModifier: pgtype.Infinity}, pgtype.Date{}, pgtype.Int8{}, nil},
		{"bad limit", day, pgtype.Date{}, pgtype.Int8{}, &negative},
		{"missing counter", day, day, pgtype.Int8{}, nil},
		{"missing date", day, pgtype.Date{}, pgtype.Int8{Int64: 1, Valid: true}, nil},
		{"infinite stored", day, pgtype.Date{Valid: true, InfinityModifier: pgtype.NegativeInfinity}, pgtype.Int8{Valid: true}, nil},
		{"future stored", day, pgtype.Date{Time: day.Time.AddDate(0, 0, 1), Valid: true}, pgtype.Int8{Valid: true}, nil},
		{"negative historical", day, pgtype.Date{Time: day.Time.AddDate(0, 0, -1), Valid: true}, pgtype.Int8{Int64: -1, Valid: true}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value, err := usageSnapshot(sqlc.GetAccountDailyCreateUsageRow{QuotaDay: tc.day, UsageDay: tc.stored, Used: tc.used}, tc.limit)
			require.ErrorIs(t, err, ErrCorrupt)
			require.Equal(t, Usage{}, value)
		})
	}
}
