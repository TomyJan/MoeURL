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

// TestSuffixNormalizationAndMatching catches substring matching, one-level-only
// matching, Unicode/ACE bypasses, userinfo confusion and new limits while empty.
func TestSuffixNormalizationAndMatching(t *testing.T) {
	suffixes, err := normalizeHosts([]string{" Z.example. ", "xn--bcher-kva.example", "example.com", "a.example.com"})
	require.NoError(t, err)
	require.Equal(t, []string{"a.example.com", "example.com", "xn--bcher-kva.example", "z.example"}, suffixes)
	for _, tc := range []struct {
		target string
		want   error
	}{
		{"https://example.com/", ErrTargetDenied},
		{"https://a.example.com/", ErrTargetDenied},
		{"https://a.b.example.com/", ErrTargetDenied},
		{"https://EXAMPLE.COM.:8080/path?q=x#f", ErrTargetDenied},
		{"https://other.example@example.com/path", ErrTargetDenied},
		{"https://example.com@other.example/path", nil},
		{"https://badexample.com/", nil},
		{"https://example.com.evil.test/", nil},
		{"https://bücher。example./", ErrTargetDenied},
		{"https://sub.xn--bcher-kva.example/", ErrTargetDenied},
		{"https://8.8.8.8/", nil},
		{"https://[2001:4860:4860::8888]/", nil},
		{"https://example.com../", ErrInvalidTarget},
		{"https://0x7f000001/", ErrInvalidTarget},
		{"https://xn--a.example/", ErrInvalidTarget},
		{"https://bad_host.example/", ErrInvalidTarget},
		{"x", ErrInvalidTarget},
	} {
		require.ErrorIs(t, checkSuffixes(suffixes, []string{tc.target}), tc.want, tc.target)
		require.NoError(t, checkSuffixes([]string{}, []string{tc.target}), "empty policy preserves caller URL validation")
	}
	require.ErrorIs(t, checkSuffixes(suffixes, []string{"https://safe.test/", "https://example.com/"}), ErrTargetDenied)
	require.ErrorIs(t, checkSuffixes([]string{"com"}, []string{"https://a.example.com/"}), ErrTargetDenied)
	for _, invalid := range [][]string{nil, {"EXAMPLE.com", "example.com."}, {"*.example.com"}, {"bücher.example"}, {"example.com\n"}, {"example.com.."}, {"example.com:443"}, {"https://example.com"}, {"127.0.0.1"}, {"a.0x1"}} {
		_, err := normalizeHosts(invalid)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf("h%03d.example", i)
	}
	got, err := normalizeHosts(items)
	require.NoError(t, err)
	require.Equal(t, items, got)
	_, err = normalizeHosts(append(items, "overflow.example"))
	require.ErrorIs(t, err, ErrInvalidInput)
}

// TestSuffixStrictJSON catches partial/coerced requests and noncanonical stored
// values, including full microsecond revisions and the exact body-size boundary.
func TestSuffixStrictJSON(t *testing.T) {
	valid := `{"suffixes":[],"expectedUpdatedAt":"2026-11-13T00:00:00.123456Z"}`
	input, err := decodeSuffixUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.Equal(t, []string{}, input.Suffixes)
	require.Equal(t, "2026-11-13T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, raw := range []string{
		"", "null", "[]", `{}`, `{"suffixes":[]}`,
		`{"suffixes":null,"expectedUpdatedAt":"x"}`, `{"suffixes":[],"expectedUpdatedAt":null}`,
		`{"suffixes":[1],"expectedUpdatedAt":"x"}`, `{"suffixes":[],"expectedUpdatedAt":4}`,
		`{"suffixes":[],"suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"suffixes":[],"expectedUpdatedAt":"x","expectedUpdatedAt":"y"}`,
		`{"suffixes":[],"expectedUpdatedAt":"x","extra":true}`,
		valid + " {}", valid + strings.Repeat(" ", 32769-len(valid)),
	} {
		_, err := decodeSuffixUpdate(strings.NewReader(raw))
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	_, err = decodeSuffixUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	row := sqlc.SystemSetting{Key: SuffixKey, Value: []byte(`{"suffixes":["a.example.com","example.com"]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Date(2026, 11, 13, 0, 0, 0, 123456000, time.UTC)}}
	stored, err := storedSuffixSettings(row)
	require.NoError(t, err)
	require.Equal(t, []string{"a.example.com", "example.com"}, stored.Suffixes)
	require.Equal(t, "2026-11-13T00:00:00.123456Z", stored.UpdatedAt)
	for _, value := range []string{`null`, `{}`, `{"suffixes":null}`, `{"suffixes":4}`, `{"suffixes":[null]}`, `{"suffixes":["UPPER.example"]}`, `{"suffixes":["z.example","a.example"]}`, `{"suffixes":["a.example","a.example"]}`, `{"suffixes":[],"extra":true}`} {
		bad := row
		bad.Value = []byte(value)
		_, err := storedSuffixSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(2026, 11, 13, 0, 0, 0, 1, time.UTC)}} {
		bad := row
		bad.UpdatedAt = version
		_, err := storedSuffixSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = "site.name"
	_, err = storedSuffixSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}
