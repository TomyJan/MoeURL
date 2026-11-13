package targetpolicy

import (
	"net/netip"
	"net/url"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

// normalizeIPs unifies mapped addresses and rejects the whole ambiguous command.
func normalizeIPs(input []string) ([]string, error) {
	if input == nil || len(input) > 100 {
		return nil, ErrInvalidInput
	}
	out := make([]string, 0, len(input))
	seen := make(map[string]bool, len(input))
	for _, raw := range input {
		if !utf8.ValidString(raw) || strings.ContainsFunc(raw, unicode.IsControl) {
			return nil, ErrInvalidInput
		}
		address, err := netip.ParseAddr(strings.TrimSpace(raw))
		if err != nil || address.Zone() != "" {
			return nil, ErrInvalidInput
		}
		canonical := address.Unmap().String()
		if seen[canonical] {
			return nil, ErrInvalidInput
		}
		seen[canonical] = true
		out = append(out, canonical)
	}
	slices.Sort(out)
	return out, nil
}

// checkIPs uses only the URL's actual literal host, never DNS resolution. Empty
// policy preserves the caller's legacy syntax; enabled policy rejects ambiguity.
func checkIPs(addresses, targets []string) error {
	if len(addresses) == 0 {
		return nil
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
			if _, found := slices.BinarySearch(addresses, address.Unmap().String()); found {
				return ErrTargetDenied
			}
			continue
		}
		if _, err := targetHost(target); err != nil {
			return err
		}
	}
	return nil
}
