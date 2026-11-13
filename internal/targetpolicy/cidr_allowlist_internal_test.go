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

// Independent literal expectations catch an intersection, a DNS/IP type mixup,
// mapped-family confusion or new URL restrictions while all resources are off.
func TestCIDRAllowlistNormalizationAndUnion(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"192.0.2.129/24", "192.0.2.0/24"}, {"2001:0DB8:1234::9/48", "2001:db8:1234::/48"},
		{"192.0.2.1/32", "192.0.2.1/32"}, {"2001:db8::1/128", "2001:db8::1/128"},
		{" 192.0.2.129/0 ", "0.0.0.0/0"}, {"2001:db8::1/0", "::/0"}, {"::192.0.2.9/128", "::c000:209/128"},
	} {
		got, err := normalizeCIDRs([]string{tc.raw})
		require.NoError(t, err)
		require.Equal(t, []string{tc.want}, got)
	}
	exact := AllowlistSettings{Enabled: true, Hosts: []string{"exact.example"}}
	suffix := SuffixAllowlistSettings{Enabled: true, Suffixes: []string{"family.example"}}
	for _, tc := range []struct {
		name, target        string
		exact, suffix, cidr bool
		prefixes            []string
		want                error
	}{
		{"exact-only match", "https://EXACT.example.:8080/path", true, true, true, []string{"192.0.2.0/24"}, nil},
		{"suffix-only match", "https://deep.family.example/", true, true, true, []string{"192.0.2.0/24"}, nil},
		{"CIDR-only match", "https://192.0.2.9/", true, true, true, []string{"192.0.2.0/24"}, nil},
		{"mapped IPv4 match", "https://[::ffff:192.0.2.9]/", true, true, true, []string{"192.0.2.0/24"}, nil},
		{"native IPv6 endpoint", "https://[2001:db8:70:ffff:ffff:ffff:ffff:ffff]/", false, false, true, []string{"2001:db8:70::/48"}, nil},
		{"native IPv6 outside", "https://[2001:db8:71::]/", false, false, true, []string{"2001:db8:70::/48"}, ErrTargetDenied},
		{"IPv4 exact match", "https://192.0.2.1/", false, false, true, []string{"192.0.2.1/32"}, nil},
		{"IPv4 exact outside", "https://192.0.2.2/", false, false, true, []string{"192.0.2.1/32"}, ErrTargetDenied},
		{"IPv6 exact match", "https://[2001:db8::1]/", false, false, true, []string{"2001:db8::1/128"}, nil},
		{"IPv6 exact outside", "https://[2001:db8::2]/", false, false, true, []string{"2001:db8::1/128"}, ErrTargetDenied},
		{"compatible is native IPv6", "https://[::192.0.2.9]/", false, false, true, []string{"192.0.2.0/24"}, ErrTargetDenied},
		{"compatible matches native /0", "https://[::192.0.2.9]/", false, false, true, []string{"::/0"}, nil},
		{"mapped misses native /0", "https://[::ffff:192.0.2.9]/", false, false, true, []string{"::/0"}, ErrTargetDenied},
		{"IPv4 /0", "https://203.0.113.255/", false, false, true, []string{"0.0.0.0/0"}, nil},
		{"IPv4 /0 excludes IPv6", "https://[2001:db8::1]/", false, false, true, []string{"0.0.0.0/0"}, ErrTargetDenied},
		{"CIDR alone rejects DNS", "https://exact.example/", false, false, true, []string{"0.0.0.0/0", "::/0"}, ErrTargetDenied},
		{"CIDR never matches userinfo", "https://192.0.2.9@other.example/", true, true, true, []string{"192.0.2.0/24"}, ErrTargetDenied},
		{"all-off retains syntax", "x", false, false, false, []string{}, nil},
		{"off CIDR retains exact rejection", "https://192.0.2.9/", true, false, false, []string{"192.0.2.0/24"}, ErrTargetDenied},
		{"off CIDR retains suffix success", "https://deep.family.example/", false, true, false, []string{"192.0.2.0/24"}, nil},
		{"unmatched DNS", "https://other.example/", true, true, true, []string{"192.0.2.0/24"}, ErrTargetDenied},
		{"unmatched IP", "https://198.51.100.1/", true, true, true, []string{"192.0.2.0/24"}, ErrTargetDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e, s := exact, suffix
			e.Enabled, s.Enabled = tc.exact, tc.suffix
			err := checkCombinedAllowlistTargets(e, s, CIDRAllowlistSettings{Enabled: tc.cidr, Prefixes: tc.prefixes}, []string{tc.target})
			if tc.want == nil {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, tc.want)
			}
		})
	}
	on := CIDRAllowlistSettings{Enabled: true, Prefixes: []string{"192.0.2.0/24"}}
	for _, target := range []string{"x", "https:///missing", "ftp://example.com/", "https://[fe80::1%25eth0]/", "https://127.1/", "https://2130706433/", "https://0177.0.0.1/", "https://0x7f.0.0.1/", "https://192.000.2.1/", "https://192.0.2.1./", "https://xn--a.example/", "https://bad_host.example/"} {
		require.ErrorIs(t, checkCombinedAllowlistTargets(exact, suffix, on, []string{target}), ErrInvalidTarget, target)
	}
	for _, raw := range []string{"broken", "192.0.2.1/24", "::ffff:192.0.2.0/120"} {
		require.ErrorIs(t, checkCombinedAllowlistTargets(exact, suffix, CIDRAllowlistSettings{Enabled: true, Prefixes: []string{raw}}, []string{"https://exact.example/"}), ErrCorrupt)
	}
	require.ErrorIs(t, checkCombinedAllowlistTargets(exact, suffix, on, []string{"https://192.0.2.9/", "https://other.example/"}), ErrTargetDenied)
}

// Enabled-empty, normalization and full-revision checks apply even to off data.
func TestCIDRAllowlistStrictJSONAndStorage(t *testing.T) {
	valid := `{"enabled":false,"prefixes":[],"expectedUpdatedAt":"2026-11-13T00:00:00.123456Z"}`
	input, err := decodeCIDRAllowlistUpdate(strings.NewReader(valid + strings.Repeat(" ", 32768-len(valid))))
	require.NoError(t, err)
	require.False(t, input.Enabled)
	require.Equal(t, []string{}, input.Prefixes)
	require.Equal(t, "2026-11-13T00:00:00.123456Z", input.ExpectedUpdatedAt)
	for _, body := range []string{valid + strings.Repeat(" ", 32769-len(valid)), valid + `{}`, "", "null", `[]`, `{}`,
		`{"prefixes":[],"expectedUpdatedAt":"x"}`, `{"enabled":false,"prefixes":[]}`,
		`{"enabled":false,"prefixes":[],"expectedUpdatedAt":null}`,
		strings.Replace(valid, `false`, `null`, 1), strings.Replace(valid, `false`, `"false"`, 1), strings.Replace(valid, `false`, `0`, 1),
		strings.Replace(valid, `[]`, `null`, 1), strings.Replace(valid, `[]`, `[1]`, 1),
		strings.Replace(valid, `"enabled":false`, `"enabled":false,"enabled":true`, 1),
		strings.Replace(valid, `"prefixes":[]`, `"Prefixes":[]`, 1), strings.Replace(valid, `"prefixes":[]`, `"prefixes":[],"extra":1`, 1),
		strings.Replace(valid, `"expectedUpdatedAt":`, `"expectedUpdatedAt":"x","expectedUpdatedAt":`, 1), string([]byte{255}),
	} {
		_, err := decodeCIDRAllowlistUpdate(strings.NewReader(body))
		require.ErrorIs(t, err, ErrInvalidInput, body[:min(len(body), 100)])
	}
	_, err = decodeCIDRAllowlistUpdate(failedReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	row := sqlc.SystemSetting{Key: CIDRAllowlistKey, Value: []byte(`{"enabled":true,"prefixes":["192.0.2.0/24","2001:db8::/32"]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Date(2026, 11, 13, 0, 0, 0, 123456000, time.UTC)}}
	got, err := storedCIDRAllowlistSettings(row)
	require.NoError(t, err)
	require.Equal(t, CIDRAllowlistSettings{Enabled: true, Prefixes: []string{"192.0.2.0/24", "2001:db8::/32"}, UpdatedAt: "2026-11-13T00:00:00.123456Z"}, got)
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf(`"192.0.2.%d/32"`, i)
	}
	for _, value := range []string{`null`, `{}`, `{"enabled":true,"prefixes":[]}`, `{"enabled":false,"prefixes":null}`,
		`{"enabled":"false","prefixes":[]}`, `{"enabled":false,"prefixes":4}`, `{"enabled":false,"prefixes":[3]}`,
		`{"enabled":false,"prefixes":["2001:DB8::/32"]}`, `{"enabled":false,"prefixes":["203.0.113.9/24"]}`,
		`{"enabled":false,"prefixes":["::ffff:c000:200/120"]}`, `{"enabled":false,"prefixes":["192.0.2.0/24","192.0.2.0/24"]}`,
		`{"enabled":false,"prefixes":["203.0.113.0/24","192.0.2.0/24"]}`, `{"enabled":false,"prefixes":[],"extra":1}`,
		`{"enabled":false,"prefixes":[` + strings.Join(items, ",") + `,"203.0.113.9/32"]}`,
	} {
		bad := row
		bad.Value = []byte(value)
		_, err := storedCIDRAllowlistSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt, value)
	}
	for _, version := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, Time: time.Date(-1, 1, 1, 0, 0, 0, 0, time.UTC)}, {Valid: true, Time: time.Date(10000, 1, 1, 0, 0, 0, 0, time.UTC)}} {
		bad := row
		bad.UpdatedAt = version
		_, err := storedCIDRAllowlistSettings(bad)
		require.ErrorIs(t, err, ErrCorrupt)
	}
	row.Key = Key
	_, err = storedCIDRAllowlistSettings(row)
	require.ErrorIs(t, err, ErrCorrupt)
}
