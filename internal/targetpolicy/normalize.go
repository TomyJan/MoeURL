package targetpolicy

import (
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

// normalizeHosts rejects the entire command on invalid or duplicate entries.
func normalizeHosts(input []string) ([]string, error) {
	if input == nil || len(input) > 100 {
		return nil, ErrInvalidInput
	}
	out := make([]string, 0, len(input))
	seen := make(map[string]bool, len(input))
	for _, raw := range input {
		if !utf8.ValidString(raw) || strings.ContainsFunc(raw, unicode.IsControl) {
			return nil, ErrInvalidInput
		}
		h, err := dnsHost(strings.TrimSpace(raw))
		if err != nil || seen[h] {
			return nil, ErrInvalidInput
		}
		seen[h] = true
		out = append(out, h)
	}
	slices.Sort(out)
	return out, nil
}

// dnsHost validates ASCII DNS syntax without rejecting ordinary double hyphens.
// Only ACE labels pass through IDNA; never accept its partial output on error.
func dnsHost(raw string) (string, error) {
	if len(raw) > 253 || strings.ContainsFunc(raw, func(r rune) bool { return r > 127 }) {
		return "", ErrInvalidInput
	}
	h := strings.ToLower(strings.TrimSuffix(raw, "."))
	if len(h) < 1 || len(h) > 253 {
		return "", ErrInvalidInput
	}
	labels := strings.Split(h, ".")
	for _, label := range labels {
		if len(label) < 1 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", ErrInvalidInput
		}
		for _, c := range label {
			if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return "", ErrInvalidInput
			}
		}
		if strings.HasPrefix(label, "xn--") {
			decoded, err := idna.Lookup.ToUnicode(label)
			if err != nil {
				return "", ErrInvalidInput
			}
			encoded, err := idna.Lookup.ToASCII(decoded)
			if err != nil || encoded != label {
				return "", ErrInvalidInput
			}
		}
	}
	tail := labels[len(labels)-1]
	if numericTail(tail) {
		return "", ErrInvalidInput
	}
	return h, nil
}

// numericTail excludes decimal and 0x hexadecimal forms browsers may treat as IP.
func numericTail(s string) bool {
	hex := strings.HasPrefix(s, "0x")
	if hex {
		s = s[2:]
	}
	if s == "" {
		return hex
	}
	for _, c := range s {
		if !(c >= '0' && c <= '9' || hex && c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

// targetHost classifies a validated original URL without rewriting its value.
func targetHost(target string) (string, error) {
	u, err := url.ParseRequestURI(target)
	if err != nil || u.Host == "" || u.Scheme != "http" && u.Scheme != "https" {
		return "", ErrInvalidTarget
	}
	h := u.Hostname()
	if _, err := netip.ParseAddr(h); err == nil {
		return "", nil
	}
	if strings.ContainsFunc(h, func(r rune) bool { return r > 127 }) {
		h, err = idna.Lookup.ToASCII(h)
		if err != nil {
			return "", ErrInvalidTarget
		}
	}
	canonical, err := dnsHost(h)
	if err != nil {
		return "", ErrInvalidTarget
	}
	return canonical, nil
}

// checkHosts preserves legacy URL syntax with an empty list; with policy enabled,
// ambiguous host classification fails rather than becoming a false non-match.
func checkHosts(hosts, targets []string) error {
	if len(hosts) == 0 {
		return nil
	}
	for _, target := range targets {
		h, err := targetHost(target)
		if err != nil {
			return err
		}
		if _, found := slices.BinarySearch(hosts, h); found {
			return ErrTargetDenied
		}
	}
	return nil
}
