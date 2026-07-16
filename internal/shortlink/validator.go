package shortlink

import (
	"net/netip"
	"net/url"
	"strings"
)

// validateTargetURL implements package-specific behavior.
func validateTargetURL(value string) error {
	parsed, err := url.ParseRequestURI(value)
	if err != nil {
		return ErrInvalidTargetURL
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return ErrInvalidTargetURL
	}
	if parsed.Host == "" {
		return ErrInvalidTargetURL
	}
	host := parsed.Hostname()
	if isLocalHostname(host) {
		return ErrInvalidTargetURL
	}
	if ip, err := netip.ParseAddr(host); err == nil && isBlockedTargetIP(ip) {
		return ErrInvalidTargetURL
	}
	return nil
}

// isLocalHostname implements package-specific behavior.
func isLocalHostname(host string) bool {
	normalized := strings.ToLower(strings.TrimSuffix(host, "."))
	return normalized == "localhost" || normalized == "localhost.localdomain"
}

// isBlockedTargetIP implements package-specific behavior.
func isBlockedTargetIP(ip netip.Addr) bool {
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}
	for _, prefix := range blockedTargetPrefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

var blockedTargetPrefixes = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("169.254.169.254/32"),
	netip.MustParsePrefix("::/128"),
	netip.MustParsePrefix("fc00::/7"),
	netip.MustParsePrefix("fe80::/10"),
}
