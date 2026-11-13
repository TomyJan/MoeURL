package targetpolicy

import (
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
	"time"
)

// TestCIDRStrictJSONAndStorage catches partial replacements, the byte-limit edge,
// invalid revisions and noncanonical persisted values being silently repaired.
func TestCIDRStrictJSONAndStorage(t *testing.T) {
	valid := `{"prefixes":[],"expectedUpdatedAt":"2026-11-13T00:00:00.123456Z"}`
	input, err := decodeCIDRUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.Equal(t, []string{}, input.Prefixes)
	require.Equal(t, "2026-11-13T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, body := range []string{
		valid + strings.Repeat(" ", 32769-len(valid)), valid + `{}`, "", "null", `[]`, `{}`, `{"prefixes":[]}`,
		`{"prefixes":[],"expectedUpdatedAt":1}`, `{"prefixes":[1],"expectedUpdatedAt":"x"}`,
		`{"prefixes":null,"expectedUpdatedAt":"x"}`, `{"prefixes":[],"expectedUpdatedAt":null}`,
		`{"prefixes":[],"prefixes":[],"expectedUpdatedAt":"x"}`, `{"prefixes":[],"expectedUpdatedAt":"x","expectedUpdatedAt":"y"}`,
		`{"Prefixes":[],"expectedUpdatedAt":"x"}`, `{"prefixes":[],"expectedUpdatedAt":"x","extra":0}`, string([]byte{255}),
	} {
		_, err := decodeCIDRUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(len(body), 100)])
	}
	_, err = decodeCIDRUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	row := sqlc.SystemSetting{Key: CIDRKey, Value: []byte(`{"prefixes":["192.0.2.0/24","2001:db8::/32"]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Date(2026, 11, 13, 0, 0, 0, 123456000, time.UTC)}}
	settings, err := storedCIDRSettings(row)
	require.NoError(t, err)
	require.Equal(t, CIDRSettings{Prefixes: []string{"192.0.2.0/24", "2001:db8::/32"}, UpdatedAt: "2026-11-13T00:00:00.123456Z"}, settings)
	for _, value := range []string{
		`null`, `{}`, `{"prefixes":null}`, `{"prefixes":3}`, `{"prefixes":[3]}`, `{"prefixes":["2001:DB8::/32"]}`,
		`{"prefixes":["::ffff:c000:200/120"]}`, `{"prefixes":["192.0.2.0/24","192.0.2.0/24"]}`, `{"prefixes":["203.0.113.0/24","192.0.2.0/24"]}`, `{"prefixes":[],"extra":1}`,
	} {
		bad := row
		bad.Value = []byte(value)
		_, err := storedCIDRSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt, value)
	}
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		bad := row
		bad.UpdatedAt = version
		_, err := storedCIDRSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = Key
	_, err = storedCIDRSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}
