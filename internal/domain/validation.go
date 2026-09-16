package domain

import (
	"errors"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/idna"
)

// ErrInvalidOrigin indicates an invalid short-link domain Origin or authority.
var ErrInvalidOrigin = errors.New("invalid domain origin")

var hostnameLabelPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)

// NormalizeOrigin canonicalizes a root Origin used for new domain registrations.
func NormalizeOrigin(value string, allowLoopbackHTTP bool) (string, error) {
	parsed, authority, err := parseAuthority(value, "")
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "https" && (parsed.Scheme != "http" || !allowLoopbackHTTP || !loopbackHost(parsed.Hostname())) {
		return "", ErrInvalidOrigin
	}
	return parsed.Scheme + "://" + authority, nil
}

// Authority returns the canonical HTTP authority of a stored Origin or legacy bare host.
func Authority(stored string) (string, error) {
	_, authority, err := parseAuthority(stored, "https")
	return authority, err
}

// MatchesHost compares an untrusted request Host with a stored domain without using proxy headers.
func MatchesHost(stored string, requestHost string) bool {
	parsed, authority, err := parseAuthority(stored, "https")
	if err != nil {
		return false
	}
	if strings.Contains(requestHost, "://") {
		return false
	}
	_, requested, err := parseAuthority(requestHost, parsed.Scheme)
	return err == nil && authority == requested
}

// parseAuthority accepts a root Origin, or a bare authority only with a default scheme.
func parseAuthority(value string, defaultScheme string) (*url.URL, string, error) {
	if value == "" || strings.TrimSpace(value) != value || strings.ContainsAny(value, "\x00\r\n\t\\") {
		return nil, "", ErrInvalidOrigin
	}
	if !strings.Contains(value, "://") && defaultScheme != "" {
		value = defaultScheme + "://" + value
	}
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" || parsed.User != nil || parsed.Opaque != "" || (parsed.Path != "" && parsed.EscapedPath() != "/") || parsed.RawQuery != "" || parsed.ForceQuery || strings.Contains(value, "#") || strings.HasSuffix(parsed.Host, ":") {
		return nil, "", ErrInvalidOrigin
	}
	hostname := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	if hostname == "" || strings.Contains(hostname, "%") {
		return nil, "", ErrInvalidOrigin
	}
	if ip := net.ParseIP(hostname); ip != nil {
		hostname = ip.String()
	} else {
		hostname, err = idna.Lookup.ToASCII(hostname)
		if err != nil || len(hostname) > 253 {
			return nil, "", ErrInvalidOrigin
		}
		for _, label := range strings.Split(hostname, ".") {
			if !hostnameLabelPattern.MatchString(label) {
				return nil, "", ErrInvalidOrigin
			}
		}
	}
	port := parsed.Port()
	if port != "" {
		portNumber, err := strconv.Atoi(port)
		if err != nil || portNumber < 1 || portNumber > 65535 {
			return nil, "", ErrInvalidOrigin
		}
		port = strconv.Itoa(portNumber)
		if (parsed.Scheme == "https" && port == "443") || (parsed.Scheme == "http" && port == "80") {
			port = ""
		}
	}
	if port != "" {
		return parsed, net.JoinHostPort(hostname, port), nil
	}
	if strings.Contains(hostname, ":") {
		return parsed, "[" + hostname + "]", nil
	}
	return parsed, hostname, nil
}

// loopbackHost permits only explicit local development HTTP Origins.
func loopbackHost(hostname string) bool {
	if strings.EqualFold(hostname, "localhost") {
		return true
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback()
}
