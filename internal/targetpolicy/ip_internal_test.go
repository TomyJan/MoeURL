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

// TestIPNormalizationAndMatching catches alias bypasses, false compatible/mapped
// equivalence, hostname confusion and browser-only numeric IP spellings.
func TestIPNormalizationAndMatching(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"192.0.2.1", "192.0.2.1"},
		{" ::ffff:192.0.2.1 ", "192.0.2.1"},
		{"::ffff:c000:201", "192.0.2.1"},
		{"2001:0DB8:0:0::1", "2001:db8::1"},
		{"::192.0.2.1", "::c000:201"},
		{"\u00a0203.0.113.9\u00a0", "203.0.113.9"},
	} {
		got, err := normalizeIPs([]string{tc.raw})
		require.NoError(t, err, tc.raw)
		require.Equal(t, []string{tc.want}, got)
	}
	got, err := normalizeIPs([]string{"2001:db8::1", "203.0.113.9", "192.0.2.1"})
	require.NoError(t, err)
	require.Equal(t, []string{"192.0.2.1", "2001:db8::1", "203.0.113.9"}, got)
	got, err = normalizeIPs([]string{})
	require.NoError(t, err)
	require.Equal(t, []string{}, got)
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf("192.0.2.%d", i)
	}
	got, err = normalizeIPs(items)
	require.NoError(t, err)
	require.Len(t, got, 100)
	for _, bad := range [][]string{
		nil, append(append([]string{}, items...), "203.0.113.9"),
		{"192.0.2.1", "::ffff:c000:201"}, {"::ffff:192.0.2.1", "::ffff:c000:201"},
		{"2001:0db8::1", "2001:db8::1"},
	} {
		_, err := normalizeIPs(bad)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, raw := range []string{
		"", " ", "192.0.2.1\n", "\t192.0.2.1", "192.0.2.1\x00", "192.0.2.1\u0085", string([]byte{255}),
		"127.1", "2130706433", "0177.0.0.1", "0x7f.0.0.1", "192.000.2.1", "192.0.2.1.",
		"fe80::1%eth0", "192.0.2.0/24", "https://192.0.2.1", "[2001:db8::1]", "192.0.2.1:443", "name@192.0.2.1", "example.com", "２００１:db8::1",
	} {
		_, err := normalizeIPs([]string{raw})
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	for _, target := range []string{
		"https://192.0.2.1/", "https://[::ffff:192.0.2.1]:8443/a?q=1#f", "http://name@[::ffff:c000:201]/", "https://name@192.0.2.1/",
		"https://[2001:0DB8:0:0::1]/",
	} {
		require.ErrorIs(t, checkIPs([]string{"192.0.2.1", "2001:db8::1"}, []string{target}), ErrTargetDenied, target)
	}
	for _, target := range []string{
		"https://[::192.0.2.1]/", "https://192.0.2.2/", "https://[2001:db8::2]/", "https://192.0.2.1@example.com/", "https://bücher。example./",
	} {
		require.NoError(t, checkIPs([]string{"192.0.2.1"}, []string{target}), target)
	}
	for _, target := range []string{
		"x", "https:///missing", "ftp://example.com/", "https://[fe80::1%25eth0]/", "https://127.1/", "https://2130706433/", "https://0177.0.0.1/", "https://0x7f.0.0.1/", "https://192.000.2.1/", "https://192.0.2.1./", "https://xn--a.example/", "https://bad_host.example/", "https://１２７。０。０。１/",
	} {
		require.ErrorIs(t, checkIPs([]string{"192.0.2.1"}, []string{target}), ErrInvalidTarget, target)
		require.NoError(t, checkIPs([]string{}, []string{target}), "empty list preserves legacy validation")
	}
	require.ErrorIs(t, checkIPs([]string{"192.0.2.1"}, []string{"https://safe.example/", "https://192.0.2.1/"}), ErrTargetDenied)
}

// TestIPStrictJSONAndStorage catches partial replacements, the byte-limit edge,
// invalid revisions and noncanonical persisted values being silently repaired.
func TestIPStrictJSONAndStorage(t *testing.T) {
	valid := `{"addresses":[],"expectedUpdatedAt":"2026-11-13T00:00:00.123456Z"}`
	input, err := decodeIPUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.Equal(t, []string{}, input.Addresses)
	require.Equal(t, "2026-11-13T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, body := range []string{
		valid + strings.Repeat(" ", 32769-len(valid)), valid + `{}`, "", "null", `[]`, `{}`, `{"addresses":[]}`,
		`{"addresses":[],"expectedUpdatedAt":1}`, `{"addresses":[1],"expectedUpdatedAt":"x"}`,
		`{"addresses":null,"expectedUpdatedAt":"x"}`, `{"addresses":[],"expectedUpdatedAt":null}`,
		`{"addresses":[],"addresses":[],"expectedUpdatedAt":"x"}`, `{"addresses":[],"expectedUpdatedAt":"x","expectedUpdatedAt":"y"}`,
		`{"Addresses":[],"expectedUpdatedAt":"x"}`, `{"addresses":[],"expectedUpdatedAt":"x","extra":0}`, string([]byte{255}),
	} {
		_, err := decodeIPUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(len(body), 100)])
	}
	_, err = decodeIPUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	row := sqlc.SystemSetting{Key: IPKey, Value: []byte(`{"addresses":["192.0.2.1","2001:db8::1"]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Date(2026, 11, 13, 0, 0, 0, 123456000, time.UTC)}}
	settings, err := storedIPSettings(row)
	require.NoError(t, err)
	require.Equal(t, IPSettings{Addresses: []string{"192.0.2.1", "2001:db8::1"}, UpdatedAt: "2026-11-13T00:00:00.123456Z"}, settings)
	for _, value := range []string{
		`null`, `{}`, `{"addresses":null}`, `{"addresses":3}`, `{"addresses":[3]}`, `{"addresses":["2001:DB8::1"]}`,
		`{"addresses":["::ffff:c000:201"]}`, `{"addresses":["192.0.2.1","192.0.2.1"]}`, `{"addresses":["203.0.113.9","192.0.2.1"]}`, `{"addresses":[],"extra":1}`,
	} {
		bad := row
		bad.Value = []byte(value)
		_, err := storedIPSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt, value)
	}
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		bad := row
		bad.UpdatedAt = version
		_, err := storedIPSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = Key
	_, err = storedIPSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}
