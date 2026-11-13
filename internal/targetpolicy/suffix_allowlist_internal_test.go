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

// TestSuffixAllowlistNormalizationAndMatching catches inverted/off-policy matching,
// suffix boundary bypasses, Unicode bypasses, and treating IP's empty host as allowed.
func TestSuffixAllowlistNormalizationAndMatching(t *testing.T) {
	hosts, err := normalizeHosts([]string{" Z.example. ", "xn--bcher-kva.example", "allowed.example"})
	require.NoError(t, err)
	require.Equal(t, []string{"allowed.example", "xn--bcher-kva.example", "z.example"}, hosts)
	policy := SuffixAllowlistSettings{Enabled: true, Suffixes: hosts}
	for _, target := range []string{"https://sub.allowed.example/", "https://a.b.allowed.example/", "https://ALLOWED.example.:8080/path?q=x#f", "http://other.example@allowed.example/", "https://bücher。example./"} {
		require.NoError(t, checkAllowlistTargets(AllowlistSettings{}, policy, []string{target}), target)
	}
	for _, target := range []string{"https://allowed.example.evil.test/", "https://notallowed.example/", "https://allowed.example@other.example/", "https://8.8.8.8/", "https://[2001:4860:4860::8888]/"} {
		require.ErrorIs(t, checkAllowlistTargets(AllowlistSettings{}, policy, []string{target}), ErrTargetDenied, target)
	}
	for _, target := range []string{"https://allowed.example../", "https://0x7f000001/", "https://xn--a.example/", "https://bad_host.example/", "x"} {
		require.ErrorIs(t, checkAllowlistTargets(AllowlistSettings{}, policy, []string{target}), ErrInvalidTarget, target)
		require.NoError(t, checkAllowlistTargets(AllowlistSettings{}, SuffixAllowlistSettings{Suffixes: hosts}, []string{target}), "off preserves caller validation")
	}
	require.ErrorIs(t, checkAllowlistTargets(AllowlistSettings{}, policy, []string{"https://allowed.example/", "https://other.example/"}), ErrTargetDenied)
	// Canonical bounds shared with denylist must also protect stored off policies.
	row := sqlc.SystemSetting{Key: SuffixAllowlistKey, UpdatedAt: pgtype.Timestamptz{Time: time.Date(2026, 11, 12, 0, 0, 0, 123456000, time.UTC), Valid: true}}
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf(`"h%03d.example"`, i)
	}
	row.Value = []byte(`{"enabled":true,"suffixes":[` + strings.Join(items, ",") + `]}`)
	got, err := storedSuffixAllowlistSettings(row)
	require.NoError(t, err)
	require.Len(t, got.Suffixes, 100)
	require.Equal(t, "2026-11-12T00:00:00.123456Z", got.UpdatedAt)
	for _, value := range []string{
		`{"enabled":true,"suffixes":[]}`, `{"enabled":false,"suffixes":null}`,
		`{"enabled":"false","suffixes":[]}`, `{"enabled":false,"suffixes":4}`,
		`{"enabled":false,"suffixes":["UPPER.example"]}`, `{"enabled":false,"suffixes":["a.example","a.example"]}`,
		`{"enabled":false,"suffixes":["z.example","a.example"]}`, `{"enabled":false,"suffixes":["bücher.example"]}`,
		`{"enabled":false,"suffixes":[` + strings.Join(items, ",") + `,"overflow.example"]}`,
	} {
		row.Value = []byte(value)
		_, err := storedSuffixAllowlistSettings(row)
		require.ErrorIs(t, err, ErrCorrupt, value)
	}
	row.Value = []byte(`{"enabled":false,"suffixes":[]}`)
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		invalid := row
		invalid.UpdatedAt = version
		_, err := storedSuffixAllowlistSettings(invalid)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = "site.name"
	_, err = storedSuffixAllowlistSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}

// TestSuffixAllowlistStrictJSON catches size off-by-one and coercing a complete
// replacement into a default-valued partial command.
func TestSuffixAllowlistStrictJSON(t *testing.T) {
	valid := `{"enabled":false,"suffixes":[],"expectedUpdatedAt":"2026-11-12T00:00:00.123456Z"}`
	input, err := decodeSuffixAllowlistUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.False(t, input.Enabled)
	require.Equal(t, []string{}, input.Suffixes)
	require.Equal(t, "2026-11-12T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, body := range []string{
		valid + strings.Repeat(" ", 32769-len(valid)), valid + `{}`, "null", `[]`, `{}`,
		`{"enabled":true,"suffixes":[],"expectedUpdatedAt":1}`,
		`{"enabled":false,"suffixes":[1],"expectedUpdatedAt":"x"}`,
		strings.Replace(valid, `false`, `null`, 1), strings.Replace(valid, `false`, `"false"`, 1),
		strings.Replace(valid, `[]`, `null`, 1), strings.Replace(valid, `false`, `0`, 1),
		strings.Replace(valid, `"enabled":false`, `"enabled":false,"enabled":true`, 1),
		strings.Replace(valid, `"suffixes":[]`, `"Suffixes":[]`, 1),
	} {
		_, err := decodeSuffixAllowlistUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(len(body), 100)])
	}
	_, err = decodeSuffixAllowlistUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
}

// TestSuffixAllowlistEnabledUnion catches intersection and disabled exact items
// granting access while only the suffix list is enabled.
func TestSuffixAllowlistEnabledUnion(t *testing.T) {
	exact := AllowlistSettings{Enabled: true, Hosts: []string{"exact.example"}}
	suffix := SuffixAllowlistSettings{Enabled: true, Suffixes: []string{"family.example"}}
	require.NoError(t, checkAllowlistTargets(exact, suffix, []string{"https://exact.example/a", "https://deep.family.example/b"}))
	require.ErrorIs(t, checkAllowlistTargets(AllowlistSettings{Hosts: exact.Hosts}, suffix, []string{"https://exact.example/a"}), ErrTargetDenied)
	require.ErrorIs(t, checkAllowlistTargets(exact, SuffixAllowlistSettings{Suffixes: suffix.Suffixes}, []string{"https://deep.family.example/b"}), ErrTargetDenied)
	require.NoError(t, checkAllowlistTargets(AllowlistSettings{}, SuffixAllowlistSettings{}, []string{"not a URL"}))
	require.NoError(t, checkAllowlistTargets(AllowlistSettings{}, SuffixAllowlistSettings{Enabled: true, Suffixes: []string{"com", "example.com"}}, []string{"https://com/", "https://deep.example.com/", "https://other.com/"}))
	require.ErrorIs(t, checkAllowlistTargets(exact, suffix, []string{"https://xn--a.example/"}), ErrInvalidTarget)
}
