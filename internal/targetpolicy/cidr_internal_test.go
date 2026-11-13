package targetpolicy

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

// Host-bit leaks, mapped-family confusion and broad-rule endpoint errors must
// change these independent literal expectations.
func TestCIDRNormalizationAndMatching(t *testing.T) {
	for _, tc := range []struct{ raw, want string }{
		{"192.0.2.129/24", "192.0.2.0/24"},
		{"2001:0DB8:1234::9/48", "2001:db8:1234::/48"},
		{"192.0.2.1/32", "192.0.2.1/32"},
		{"2001:db8::1/128", "2001:db8::1/128"},
		{" 192.0.2.129/0 ", "0.0.0.0/0"},
		{"2001:db8::1/0", "::/0"},
		{"::192.0.2.9/128", "::c000:209/128"},
		{"\u00a0203.0.113.255/25\u00a0", "203.0.113.128/25"},
	} {
		got, err := normalizeCIDRs([]string{tc.raw})
		require.NoError(t, err, tc.raw)
		require.Equal(t, []string{tc.want}, got)
	}
	got, err := normalizeCIDRs([]string{"203.0.113.128/25", "2001:db8::/32", "203.0.113.0/24"})
	require.NoError(t, err)
	require.Equal(t, []string{"2001:db8::/32", "203.0.113.0/24", "203.0.113.128/25"}, got, "overlap remains removable independently")
	got, err = normalizeCIDRs([]string{})
	require.NoError(t, err)
	require.Equal(t, []string{}, got)
	items := make([]string, 100)
	for i := range items {
		items[i] = fmt.Sprintf("192.0.2.%d/32", i)
	}
	got, err = normalizeCIDRs(items)
	require.NoError(t, err)
	require.Len(t, got, 100)
	for _, bad := range [][]string{nil, append(items, "203.0.113.9/32"), {"192.0.2.129/24", "192.0.2.0/24"}, {"2001:DB8::9/32", "2001:db8::/32"}} {
		_, err := normalizeCIDRs(bad)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, raw := range []string{
		"", " ", "192.0.2.0", "192.0.2.0/", "192.0.2.0/024", "192.0.2.0/+24", "192.0.2.0/-1", "192.0.2.0/２４", "192.0.2.0/0000", "192.0.2.0/24/1", "192.0.2.0/33", "2001:db8::/129",
		"::ffff:192.0.2.0/120", "::ffff:c000:200/120", "::ffff:0:0/0", "fe80::1%eth0/64", "192.000.2.0/24", "127.1/8", "2130706433/8", "0x7f.0.0.1/8", "192.0.2.0/24\n", "\t192.0.2.0/24", "192.0.2.0/24\u0085", string([]byte{255}), "https://192.0.2.0/24", "[2001:db8::]/32", "example.com/24",
	} {
		_, err := normalizeCIDRs([]string{raw})
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	for _, tc := range []struct {
		prefixes []string
		target   string
		want     error
	}{
		{[]string{"192.0.2.0/24"}, "https://192.0.2.0/", ErrTargetDenied},
		{[]string{"192.0.2.0/24"}, "https://192.0.2.255/", ErrTargetDenied},
		{[]string{"192.0.2.0/24"}, "https://192.0.3.0/", nil},
		{[]string{"192.0.2.0/24"}, "https://[::ffff:c000:2ff]:8443/a?q=1#f", ErrTargetDenied},
		{[]string{"192.0.2.0/24"}, "https://[::192.0.2.9]/", nil},
		{[]string{"::/0"}, "https://[::192.0.2.9]/", ErrTargetDenied},
		{[]string{"::/0"}, "https://[::ffff:192.0.2.9]/", nil},
		{[]string{"0.0.0.0/0"}, "https://[::ffff:192.0.2.9]/", ErrTargetDenied},
		{[]string{"0.0.0.0/0"}, "https://[2001:db8::1]/", nil},
		{[]string{"2001:db8:70::/48"}, "https://[2001:db8:70:ffff:ffff:ffff:ffff:ffff]/", ErrTargetDenied},
		{[]string{"2001:db8:70::/48"}, "https://[2001:db8:71::]/", nil},
		{[]string{"192.0.2.1/32"}, "https://192.0.2.1/", ErrTargetDenied},
		{[]string{"192.0.2.1/32"}, "https://192.0.2.2/", nil},
		{[]string{"2001:db8::1/128"}, "https://[2001:db8::1]/", ErrTargetDenied},
		{[]string{"2001:db8::1/128"}, "https://[2001:db8::2]/", nil},
		{[]string{"0.0.0.0/0", "::/0"}, "https://192.0.2.1@example.com/", nil},
		{[]string{"0.0.0.0/0", "::/0"}, "https://bücher。example./", nil},
	} {
		err := checkCIDRs(tc.prefixes, []string{tc.target})
		if tc.want == nil {
			require.NoError(t, err, tc.target)
		} else {
			require.ErrorIs(t, err, tc.want, tc.target)
		}
	}
	for _, target := range []string{"x", "https:///missing", "ftp://example.com/", "https://[fe80::1%25eth0]/", "https://127.1/", "https://2130706433/", "https://0177.0.0.1/", "https://0x7f.0.0.1/", "https://192.000.2.1/", "https://192.0.2.1./", "https://xn--a.example/", "https://bad_host.example/", "https://１２７。０。０。１/"} {
		require.ErrorIs(t, checkCIDRs([]string{"192.0.2.0/24"}, []string{target}), ErrInvalidTarget, target)
		require.NoError(t, checkCIDRs([]string{}, []string{target}), "empty preserves legacy syntax")
	}
	for _, prefix := range []string{"broken", "192.0.2.1/24", "::ffff:192.0.2.0/120"} {
		require.ErrorIs(t, checkCIDRs([]string{prefix}, []string{"https://safe.example/"}), ErrCorrupt)
	}
	require.ErrorIs(t, checkCIDRs([]string{"203.0.113.0/24"}, []string{"https://safe.example/", "https://203.0.113.9/"}), ErrTargetDenied)
}
