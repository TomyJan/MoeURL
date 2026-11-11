package targetpolicy

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestAllowlistNormalizationAndMatching catches inverted/off-policy matching,
// suffix acceptance, Unicode bypasses, and treating IP's empty host as allowed.
func TestAllowlistNormalizationAndMatching(t *testing.T) {
	hosts, err := normalizeHosts([]string{" Z.example. ", "xn--bcher-kva.example", "allowed.example"})
	require.NoError(t, err)
	require.Equal(t, []string{"allowed.example", "xn--bcher-kva.example", "z.example"}, hosts)
	policy := AllowlistSettings{Enabled: true, Hosts: hosts}
	for _, target := range []string{"https://ALLOWED.example.:8080/path?q=x#f", "http://other.example@allowed.example/", "https://bücher。example./"} {
		require.NoError(t, checkAllowlistHosts(policy, []string{target}), target)
	}
	for _, target := range []string{"https://sub.allowed.example/", "https://notallowed.example/", "https://allowed.example@other.example/", "https://8.8.8.8/", "https://[2001:4860:4860::8888]/"} {
		require.ErrorIs(t, checkAllowlistHosts(policy, []string{target}), ErrTargetDenied, target)
	}
	for _, target := range []string{"https://allowed.example../", "https://0x7f000001/", "https://xn--a.example/", "https://bad_host.example/", "x"} {
		require.ErrorIs(t, checkAllowlistHosts(policy, []string{target}), ErrInvalidTarget, target)
		require.NoError(t, checkAllowlistHosts(AllowlistSettings{Hosts: hosts}, []string{target}), "off preserves caller validation")
	}
	require.ErrorIs(t, checkAllowlistHosts(policy, []string{"https://allowed.example/", "https://other.example/"}), ErrTargetDenied)
	// Canonical bounds shared with denylist must also protect stored off policies.
	row := sqlc.SystemSetting{Key: AllowlistKey, UpdatedAt: pgtype.Timestamptz{Time: time.Date(2026, 11, 12, 0, 0, 0, 123456000, time.UTC), Valid: true}}
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf(`"h%03d.example"`, i)
	}
	row.Value = []byte(`{"enabled":true,"hosts":[` + strings.Join(items, ",") + `]}`)
	got, err := storedAllowlistSettings(row)
	require.NoError(t, err)
	require.Len(t, got.Hosts, 100)
	require.Equal(t, "2026-11-12T00:00:00.123456Z", got.UpdatedAt)
	for _, value := range []string{
		`{"enabled":true,"hosts":[]}`, `{"enabled":false,"hosts":null}`,
		`{"enabled":"false","hosts":[]}`, `{"enabled":false,"hosts":4}`,
		`{"enabled":false,"hosts":["UPPER.example"]}`, `{"enabled":false,"hosts":["a.example","a.example"]}`,
		`{"enabled":false,"hosts":["z.example","a.example"]}`, `{"enabled":false,"hosts":["bücher.example"]}`,
		`{"enabled":false,"hosts":[` + strings.Join(items, ",") + `,"overflow.example"]}`,
	} {
		row.Value = []byte(value)
		_, err := storedAllowlistSettings(row)
		require.ErrorIs(t, err, ErrCorrupt, value)
	}
	row.Value = []byte(`{"enabled":false,"hosts":[]}`)
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		invalid := row
		invalid.UpdatedAt = version
		_, err := storedAllowlistSettings(invalid)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = "site.name"
	_, err = storedAllowlistSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}

// TestAllowlistStrictJSON catches size off-by-one and coercing a complete
// replacement into a default-valued partial command.
func TestAllowlistStrictJSON(t *testing.T) {
	valid := `{"enabled":false,"hosts":[],"expectedUpdatedAt":"2026-11-12T00:00:00.123456Z"}`
	input, err := decodeAllowlistUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.False(t, input.Enabled)
	require.Equal(t, []string{}, input.Hosts)
	require.Equal(t, "2026-11-12T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, body := range []string{
		valid + strings.Repeat(" ", 32769-len(valid)), valid + `{}`, "null", `[]`, `{}`,
		`{"enabled":true,"hosts":[],"expectedUpdatedAt":1}`,
		`{"enabled":false,"hosts":[1],"expectedUpdatedAt":"x"}`,
		strings.Replace(valid, `false`, `null`, 1), strings.Replace(valid, `false`, `"false"`, 1),
		strings.Replace(valid, `[]`, `null`, 1), strings.Replace(valid, `false`, `0`, 1),
		strings.Replace(valid, `"enabled":false`, `"enabled":false,"enabled":true`, 1),
		strings.Replace(valid, `"hosts":[]`, `"Hosts":[]`, 1),
	} {
		_, err := decodeAllowlistUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(len(body), 100)])
	}
	_, err = decodeAllowlistUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
}
