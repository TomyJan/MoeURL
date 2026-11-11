package targetpolicy

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestTargetHostNormalization catches accepting ambiguous/IP-shaped entries,
// silently dropping duplicates, or imposing IDNA's double-hyphen rule on ASCII.
func TestTargetHostNormalization(t *testing.T) {
	long := strings.Repeat("a", 63) + "." + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
	for _, tc := range []struct {
		name     string
		in, want []string
	}{
		{"empty", []string{}, []string{}},
		{"canonical sorted", []string{" Example.COM. ", "Ab--CD.example", "xn--bcher-kva.example"}, []string{"ab--cd.example", "example.com", "xn--bcher-kva.example"}},
		{"253 bytes", []string{long}, []string{long}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeHosts(tc.in)
			require.NoError(t, err)
			require.Equal(t, tc.want, got)
		})
	}
	for _, tc := range []struct {
		name string
		in   []string
	}{
		{"null", nil}, {"empty item", []string{""}}, {"duplicate", []string{"EXAMPLE.com.", "example.com"}},
		{"newline", []string{"example.com\n"}}, {"tab", []string{"\texample.com"}}, {"invalid UTF8", []string{string([]byte{255})}},
		{"URL", []string{"https://example.com"}}, {"port", []string{"example.com:443"}}, {"userinfo", []string{"safe@example.com"}},
		{"unicode", []string{"bücher.example"}}, {"wildcard", []string{"*.example"}}, {"underscore", []string{"x_y.example"}},
		{"unicode folds to ASCII", []string{"K.example"}}, {"dotted capital I", []string{"İ.example"}},
		{"empty label", []string{"a..example"}}, {"two final dots", []string{"example.com.."}}, {"leading hyphen", []string{"-a.example"}},
		{"trailing hyphen", []string{"a-.example"}}, {"64 label", []string{strings.Repeat("a", 64) + ".example"}},
		{"254 bytes", []string{long + "e"}}, {"254 including dot", []string{long + "."}},
		{"IP", []string{"8.8.8.8"}}, {"IPv6", []string{"2001:4860:4860::8888"}},
		{"short IP", []string{"127.1"}}, {"decimal IP", []string{"2130706433"}}, {"hex IP", []string{"0x7f000001"}}, {"empty hex", []string{"0x"}},
		{"numeric suffix", []string{"example.123"}}, {"hex suffix", []string{"example.0xff"}},
		{"bad ACE", []string{"xn--a.example"}}, {"empty ACE", []string{"xn--.example"}}, {"mapped ACE", []string{"xn--62g.example"}},
	} {
		t.Run(tc.name, func(t *testing.T) { _, err := normalizeHosts(tc.in); require.ErrorIs(t, err, ErrInvalidInput) })
	}
	hosts := make([]string, 100)
	for i := range hosts {
		hosts[i] = fmt.Sprintf("h%03d.example", i)
	}
	got, err := normalizeHosts(hosts)
	require.NoError(t, err)
	require.Len(t, got, 100)
	_, err = normalizeHosts(append(hosts, "overflow.example"))
	require.ErrorIs(t, err, ErrInvalidInput)
}

// TestTargetHostMatching catches userinfo, Unicode and trailing-dot bypasses,
// suffix overmatching, and accidental expansion of the empty-policy contract.
func TestTargetHostMatching(t *testing.T) {
	hosts := []string{"blocked.example", "xn--bcher-kva.example"}
	for _, target := range []string{"https://blocked.example/a", "http://BLOCKED.example.:8080/b?q=x#f", "https://safe.example@blocked.example/", "https://bücher.example/a", "https://bücher。example./"} {
		require.ErrorIs(t, checkHosts(hosts, []string{target}), ErrTargetDenied, target)
	}
	for _, target := range []string{"https://sub.blocked.example/", "https://blocked.example@safe.example/", "https://notblocked.example/", "https://8.8.8.8/a", "https://[2001:4860:4860::8888]/", "https://ab--cd.example/"} {
		require.NoError(t, checkHosts(hosts, []string{target}), target)
	}
	for _, target := range []string{"https://blocked.example../", "https://１２７。０。０。１/", "https://0x7f000001/", "https://xn--a.example/", "https://bad_host.example/", "https://example.123/", "https://\u200d.example/", "x", "https:///nohost"} {
		require.ErrorIs(t, checkHosts(hosts, []string{target}), ErrInvalidTarget, target)
		require.NoError(t, checkHosts([]string{}, []string{target}), "legacy validator remains the caller's responsibility")
	}
}
