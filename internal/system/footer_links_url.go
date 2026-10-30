package system

import (
	"net/netip"
	"net/url"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

// normalizeFooterLinkURL never resolves or fetches a target. Only scheme and
// authority are normalized; the original path/query/fragment bytes survive.
func normalizeFooterLinkURL(raw string) (string, error) {
	if !footerTextValid(raw) {
		return "", ErrInvalidFooterLinks
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || len(raw) > 2048 || !footerURLBytesValid(raw) {
		return "", ErrInvalidFooterLinks
	}
	separator := strings.Index(raw, "://")
	if separator < 0 {
		return "", ErrInvalidFooterLinks
	}
	scheme := strings.ToLower(raw[:separator])
	if scheme != "http" && scheme != "https" {
		return "", ErrInvalidFooterLinks
	}
	remainder := raw[separator+3:]
	authority, suffix := remainder, ""
	if index := strings.IndexAny(remainder, "/?#"); index >= 0 {
		authority, suffix = remainder[:index], remainder[index:]
	}
	if authority == "" || strings.ContainsAny(authority, "@%") {
		return "", ErrInvalidFooterLinks
	}
	host, port, hasPort := authority, "", false
	if strings.HasPrefix(authority, "[") {
		end := strings.IndexByte(authority, ']')
		if end < 0 {
			return "", ErrInvalidFooterLinks
		}
		address, err := netip.ParseAddr(authority[1:end])
		if err != nil || !address.Is6() || address.Is4In6() || address.Zone() != "" {
			return "", ErrInvalidFooterLinks
		}
		host = "[" + address.String() + "]"
		if rest := authority[end+1:]; rest != "" {
			if !strings.HasPrefix(rest, ":") {
				return "", ErrInvalidFooterLinks
			}
			port, hasPort = rest[1:], true
		}
	} else {
		if strings.Count(authority, ":") > 1 {
			return "", ErrInvalidFooterLinks
		}
		if index := strings.IndexByte(authority, ':'); index >= 0 {
			host, port, hasPort = authority[:index], authority[index+1:], true
		}
		var err error
		host, err = footerDNSOrIPv4(host)
		if err != nil {
			return "", err
		}
	}
	// Keep our authority contract explicit before the standard parser's
	// overlapping syntax checks. Both validations must succeed; the raw suffix
	// is still returned verbatim rather than serialized through net/url.
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Opaque != "" || parsed.User != nil || parsed.Host != authority {
		return "", ErrInvalidFooterLinks
	}
	if hasPort {
		if port == "" || strings.Trim(port, "0123456789") != "" {
			return "", ErrInvalidFooterLinks
		}
		value, err := strconv.ParseUint(port, 10, 16)
		if err != nil || value == 0 {
			return "", ErrInvalidFooterLinks
		}
		if !(scheme == "http" && value == 80) && !(scheme == "https" && value == 443) {
			host += ":" + strconv.FormatUint(value, 10)
		}
	}
	return scheme + "://" + host + suffix, nil
}

// footerURLBytesValid checks the unrewritten URI bytes and percent-encoded
// controls without decoding or canonicalizing the administrator's URL suffix.
func footerURLBytesValid(raw string) bool {
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if !footerASCIIAlphanumeric(c) && !strings.ContainsRune(":/?#[]@!$&'()*+,;=-._~%", rune(c)) {
			return false
		}
		if c == '%' {
			if i+2 >= len(raw) || !footerHexDigits(raw[i+1:i+3]) {
				return false
			}
			value, _ := strconv.ParseUint(raw[i+1:i+3], 16, 8)
			if value < 32 || value == 127 {
				return false
			}
			i += 2
		}
	}
	return true
}

// footerDNSOrIPv4 excludes numeric host shorthands and validates only ACE
// labels through IDNA, leaving ordinary ASCII double-hyphen labels permitted.
func footerDNSOrIPv4(raw string) (string, error) {
	if address, err := netip.ParseAddr(raw); err == nil && address.Is4() && address.String() == raw {
		return raw, nil
	}
	host := strings.ToLower(raw)
	if len(host) == 0 || len(host) > 253 {
		return "", ErrInvalidFooterLinks
	}
	labels := strings.Split(host, ".")
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", ErrInvalidFooterLinks
		}
		for i := 0; i < len(label); i++ {
			if !footerASCIIAlphanumeric(label[i]) && label[i] != '-' {
				return "", ErrInvalidFooterLinks
			}
		}
		// Ordinary ASCII DNS labels follow the explicit syntax above, not
		// IDNA's reserved third/fourth-position hyphen rule for U-labels.
		if strings.HasPrefix(label, "xn--") {
			ascii, err := idna.Lookup.ToASCII(label)
			if err != nil || ascii != label {
				return "", ErrInvalidFooterLinks
			}
		}
	}
	last := labels[len(labels)-1]
	if strings.Trim(last, "0123456789") == "" || (strings.HasPrefix(last, "0x") && footerHexDigits(last[2:])) {
		return "", ErrInvalidFooterLinks
	}
	return host, nil
}

// footerASCIIAlphanumeric deliberately accepts ASCII bytes only; Unicode host
// labels must arrive as validated ACE and URI suffixes as percent-encoded bytes.
func footerASCIIAlphanumeric(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

// footerHexDigits checks only the character set. The caller supplies escape
// width or host-label rules; an empty suffix is intentionally accepted here.
func footerHexDigits(raw string) bool {
	for i := 0; i < len(raw); i++ {
		c := raw[i]
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f' || c >= 'A' && c <= 'F') {
			return false
		}
	}
	return true
}
