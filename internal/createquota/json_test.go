package createquota

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

type failedReader struct{}

func (failedReader) Read([]byte) (int, error) { return 0, errors.New("unavailable reader") }

// TestDailyCreateQuotaStrictJSON catches missing/null conflation, coercion,
// duplicate escaped keys, size off-by-one and loss of full revision precision.
func TestDailyCreateQuotaStrictJSON(t *testing.T) {
	const revision = "2026-11-12T01:02:03.123456Z"
	for _, limit := range []string{"null", "0", "1", "1000000"} {
		body := fmt.Sprintf(`{"dailyLimit":%s,"expectedUpdatedAt":%q}`, limit, revision)
		got, err := decodeUpdate(strings.NewReader(body + strings.Repeat(" ", 4096-len(body))))
		require.NoError(t, err)
		require.Equal(t, revision, got.ExpectedUpdatedAt)
		if limit == "null" {
			require.Nil(t, got.DailyLimit)
		} else {
			require.NotNil(t, got.DailyLimit)
			require.Equal(t, limit, fmt.Sprint(*got.DailyLimit))
		}
	}
	valid := fmt.Sprintf(`{"dailyLimit":1,"expectedUpdatedAt":%q}`, revision)
	for _, body := range []string{
		"", "null", "[]", `"a"`, `{}`, `{1:2}`, `{"dailyLimit":}`, `{"dailyLimit":1]`,
		`{"dailyLimit":1,"expectedUpdatedAt":null}`, `{"dailyLimit":1,"expectedUpdatedAt":2}`,
		`{"dailyLimit":1,"expectedUpdatedAt":"x","extra":true}`, `{"dailyLimit":1,"\u0064ailyLimit":2,"expectedUpdatedAt":"x"}`,
		strings.Replace(valid, `"dailyLimit"`, `"DailyLimit"`, 1), valid + `{}`, valid + strings.Repeat(" ", 4097-len(valid)),
		string([]byte{'{', 0xff, '}'}),
	} {
		_, err := decodeUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(100, len(body))])
	}
	for _, limit := range []string{`"1"`, `true`, `[]`, `{}`, `-1`, `1000001`, `1.1`, `1.0`, `1e2`, `9223372036854775808`} {
		_, err := decodeUpdate(strings.NewReader(fmt.Sprintf(`{"dailyLimit":%s,"expectedUpdatedAt":%q}`, limit, revision)))
		require.ErrorIs(t, err, ErrInvalidInput, limit)
	}
	_, err := decodeUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	for _, raw := range []string{"", "x", "0000-01-01T00:00:00Z", "0001-01-01T00:00:00Z", "10000-01-01T00:00:00Z", "2026-11-12T01:02:03.1234561Z", "2026-99-99T00:00:00Z"} {
		_, err := parseVersion(raw)
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	for _, raw := range []string{revision, "2026-11-12T01:02:03.123456+00:00", "2026-11-12T09:02:03.123456+08:00"} {
		got, err := parseVersion(raw)
		require.NoError(t, err)
		require.Equal(t, time.Date(2026, 11, 12, 1, 2, 3, 123456000, time.UTC), got.UTC())
	}
}

// TestDailyCreateQuotaStoredData catches corrupt off-policy data being silently
// accepted and zero being mistaken for the unlimited default.
func TestDailyCreateQuotaStoredData(t *testing.T) {
	row := sqlc.SystemSetting{Key: Key, UpdatedAt: pgtype.Timestamptz{Time: time.Date(2026, 11, 12, 1, 2, 3, 123456000, time.UTC), Valid: true}}
	for _, limit := range []string{"null", "0", "1000000"} {
		row.Value = []byte(`{"dailyLimit":` + limit + `}`)
		got, err := storedSettings(row)
		require.NoError(t, err)
		require.Equal(t, "2026-11-12T01:02:03.123456Z", got.UpdatedAt)
	}
	for _, raw := range []string{`null`, `{}`, `{"dailyLimit":false}`, `{"dailyLimit":-1}`, `{"dailyLimit":1000001}`, `{"dailyLimit":1.0}`, `{"dailyLimit":null,"extra":1}`} {
		row.Value = []byte(raw)
		_, err := storedSettings(row)
		require.ErrorIs(t, err, ErrCorrupt, raw)
	}
	row.Value = []byte(`{"dailyLimit":null}`)
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		r := row
		r.UpdatedAt = version
		_, err := storedSettings(r)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = "site.name"
	_, err := storedSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
	zero, one := int64(0), int64(1)
	require.False(t, sameLimit(nil, &zero))
	require.False(t, sameLimit(&zero, nil))
	require.False(t, sameLimit(&zero, &one))
	require.True(t, sameLimit(nil, nil))
	require.True(t, sameLimit(&zero, &zero))
}

// TestDailyCreateQuotaCountBoundaries catches a day reset/refund, overflow or
// limit subtraction that turns an overdrawn account into available capacity.
func TestDailyCreateQuotaCountBoundaries(t *testing.T) {
	day := pgtype.Date{Time: time.Date(2026, 11, 12, 0, 0, 0, 0, time.UTC), Valid: true}
	one, zero, twenty := int64(1), int64(0), int64(20)
	for _, tc := range []struct {
		name   string
		offset int
		used   int64
		count  int
		limit  *int64
		want   int64
		err    error
	}{
		{"unlimited", 0, 2, 20, nil, 22, nil}, {"zero", 0, 0, 1, &zero, 0, ErrExhausted}, {"last", 0, 0, 1, &one, 1, nil},
		{"exhausted", 0, 1, 1, &one, 0, ErrExhausted}, {"lowered", 0, 9, 1, &one, 0, ErrExhausted},
		{"whole batch", 0, 0, 20, &twenty, 20, nil}, {"one too many", 0, 1, 20, &twenty, 0, ErrExhausted},
		{"next day", -1, 999, 1, &one, 1, nil}, {"future", 1, 1, 1, nil, 0, ErrCorrupt},
		{"negative", 0, -1, 1, nil, 0, ErrCorrupt}, {"overflow", 0, math.MaxInt64, 1, nil, 0, ErrCorrupt},
	} {
		t.Run(tc.name, func(t *testing.T) {
			saved := day
			saved.Time = saved.Time.AddDate(0, 0, tc.offset)
			got, err := nextCount(sqlc.LockAccountDailyCreateUsageRow{UsageDay: saved, Used: tc.used}, day, tc.count, tc.limit)
			require.ErrorIs(t, err, tc.err)
			require.Equal(t, tc.want, got)
		})
	}
	for _, invalid := range []pgtype.Date{{}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(0, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		_, err := nextCount(sqlc.LockAccountDailyCreateUsageRow{UsageDay: day}, invalid, 1, nil)
		require.ErrorIs(t, err, ErrCorrupt)
		_, err = nextCount(sqlc.LockAccountDailyCreateUsageRow{UsageDay: invalid}, day, 1, nil)
		require.ErrorIs(t, err, ErrCorrupt)
	}
}
