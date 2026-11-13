package targetpolicy

import (
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// normalizeCIDRs masks host bits without merging independently removable rules.
func normalizeCIDRs(input []string) ([]string, error) {
	if input == nil || len(input) > 100 {
		return nil, ErrInvalidInput
	}
	out := make([]string, 0, len(input))
	seen := make(map[string]bool, len(input))
	for _, raw := range input {
		if !utf8.ValidString(raw) || strings.ContainsFunc(raw, unicode.IsControl) {
			return nil, ErrInvalidInput
		}
		text := strings.TrimSpace(raw)
		_, bits, found := strings.Cut(text, "/")
		if !found || len(bits) < 1 || len(bits) > 3 || len(bits) > 1 && bits[0] == '0' {
			return nil, ErrInvalidInput
		}
		for _, b := range bits {
			if b < '0' || b > '9' {
				return nil, ErrInvalidInput
			}
		}
		prefix, err := netip.ParsePrefix(text)
		if err != nil || prefix.Addr().Zone() != "" || prefix.Addr().Is4In6() {
			return nil, ErrInvalidInput
		}
		canonical := prefix.Masked().String()
		if seen[canonical] {
			return nil, ErrInvalidInput
		}
		seen[canonical] = true
		out = append(out, canonical)
	}
	slices.Sort(out)
	return out, nil
}

// checkCIDRs matches actual literal hosts only. Mapped targets retain the same
// IPv4 identity used by the exact-address resource; DNS is never resolved.
func checkCIDRs(prefixes, targets []string) error {
	if len(prefixes) == 0 {
		return nil
	}
	networks := make([]netip.Prefix, 0, len(prefixes))
	for _, raw := range prefixes {
		prefix, err := netip.ParsePrefix(raw)
		if err != nil || prefix.Addr().Is4In6() || prefix != prefix.Masked() {
			return ErrCorrupt
		}
		networks = append(networks, prefix)
	}
	for _, target := range targets {
		u, err := url.ParseRequestURI(target)
		if err != nil || u.Host == "" || u.Scheme != "http" && u.Scheme != "https" {
			return ErrInvalidTarget
		}
		address, err := netip.ParseAddr(u.Hostname())
		if err == nil {
			if address.Zone() != "" {
				return ErrInvalidTarget
			}
			for _, network := range networks {
				if network.Contains(address.Unmap()) {
					return ErrTargetDenied
				}
			}
			continue
		}
		if _, err := targetHost(target); err != nil {
			return err
		}
	}
	return nil
}
