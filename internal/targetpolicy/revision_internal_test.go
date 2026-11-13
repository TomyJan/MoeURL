package targetpolicy

import (
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestPolicyRevisionYearBounds catches revisions that cannot round-trip through
// the four-digit UTC wire format, without losing valid offsets or microseconds.
func TestPolicyRevisionYearBounds(t *testing.T) {
	for _, raw := range []string{
		"0000-01-01T00:00:00Z", "0000-12-31T23:59:59-00:01",
		"0001-01-01T00:00:00+00:01", "9999-12-31T23:59:59-00:01",
		"0001-01-01T00:00:00Z", "0001-01-01T08:00:00+08:00",
		"9999-12-31T23:59:59.999999001Z",
	} {
		t.Run("reject_"+raw, func(t *testing.T) {
			_, err := parseVersion(raw)
			require.ErrorIs(t, err, ErrInvalidInput)
		})
	}
	for _, tc := range []struct{ raw, utc string }{
		{"0001-01-01T00:00:00.000001Z", "0001-01-01T00:00:00.000001Z"},
		{"0001-01-01T08:00:00.000001+08:00", "0001-01-01T00:00:00.000001Z"},
		{"0001-01-01T00:00:00-00:01", "0001-01-01T00:01:00Z"},
		{"9999-12-31T23:59:59.999999Z", "9999-12-31T23:59:59.999999Z"},
		{"9999-12-31T23:59:59.999999+00:01", "9999-12-31T23:58:59.999999Z"},
		{"2026-11-14T08:00:00.123456000+08:00", "2026-11-14T00:00:00.123456Z"},
	} {
		t.Run("accept_"+tc.raw, func(t *testing.T) {
			got, err := parseVersion(tc.raw)
			require.NoError(t, err)
			require.Equal(t, tc.utc, got.UTC().Format(time.RFC3339Nano))
			want, err := time.Parse(time.RFC3339Nano, tc.raw)
			require.NoError(t, err)
			require.Equal(t, want, got, "the caller's offset and complete time must survive")
		})
	}
}

// TestStoredPolicyRevisionYearBounds verifies every policy fails closed for a
// revision the client cannot send back, and preserves the usable extreme years.
func TestStoredPolicyRevisionYearBounds(t *testing.T) {
	policies := []struct {
		key, value string
		read       func(sqlc.SystemSetting) (string, error)
	}{
		{Key, `{"hosts":[]}`, func(row sqlc.SystemSetting) (string, error) { v, e := storedSettings(row); return v.UpdatedAt, e }},
		{AllowlistKey, `{"enabled":false,"hosts":[]}`, func(row sqlc.SystemSetting) (string, error) {
			v, e := storedAllowlistSettings(row)
			return v.UpdatedAt, e
		}},
		{SuffixKey, `{"suffixes":[]}`, func(row sqlc.SystemSetting) (string, error) { v, e := storedSuffixSettings(row); return v.UpdatedAt, e }},
		{SuffixAllowlistKey, `{"enabled":false,"suffixes":[]}`, func(row sqlc.SystemSetting) (string, error) {
			v, e := storedSuffixAllowlistSettings(row)
			return v.UpdatedAt, e
		}},
		{IPKey, `{"addresses":[]}`, func(row sqlc.SystemSetting) (string, error) { v, e := storedIPSettings(row); return v.UpdatedAt, e }},
		{CIDRKey, `{"prefixes":[]}`, func(row sqlc.SystemSetting) (string, error) { v, e := storedCIDRSettings(row); return v.UpdatedAt, e }},
		{CIDRAllowlistKey, `{"enabled":false,"prefixes":[]}`, func(row sqlc.SystemSetting) (string, error) {
			v, e := storedCIDRAllowlistSettings(row)
			return v.UpdatedAt, e
		}},
	}
	for _, policy := range policies {
		t.Run(policy.key, func(t *testing.T) {
			row := sqlc.SystemSetting{Key: policy.key, Value: []byte(policy.value)}
			for _, year := range []int{-1, 0, 10000} {
				row.UpdatedAt = pgtype.Timestamptz{Valid: true, Time: time.Date(year, 6, 1, 0, 0, 0, 0, time.UTC)}
				_, err := policy.read(row)
				require.ErrorIs(t, err, ErrCorrupt, "year %d", year)
			}
			for _, raw := range []string{"0001-01-01T00:00:00.000001Z", "9999-12-31T23:59:59.999999Z"} {
				stamp, err := time.Parse(time.RFC3339Nano, raw)
				require.NoError(t, err)
				row.UpdatedAt = pgtype.Timestamptz{Valid: true, Time: stamp}
				got, err := policy.read(row)
				require.NoError(t, err)
				require.Equal(t, raw, got)
			}
		})
	}
}
