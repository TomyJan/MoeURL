package oidc

import (
	"net"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"golang.org/x/net/idna"
)

var (
	providerKeyPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$`)
	domainLabelPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`)
)

// normalizeProviderInput validates and canonicalizes values shared by create and update operations.
func normalizeProviderInput(input providerInput, allowInsecureLoopback bool) (providerInput, error) {
	input.Key = strings.TrimSpace(input.Key)
	input.DisplayName = strings.TrimSpace(input.DisplayName)
	input.IssuerURL = strings.TrimSpace(input.IssuerURL)
	input.ClientID = strings.TrimSpace(input.ClientID)
	if !providerKeyPattern.MatchString(input.Key) || len(input.Key) > 64 {
		return providerInput{}, ErrInvalidInput
	}
	if input.DisplayName == "" || utf8.RuneCountInString(input.DisplayName) > 100 {
		return providerInput{}, ErrInvalidInput
	}
	if input.ClientID == "" || len(input.ClientID) > 512 {
		return providerInput{}, ErrInvalidInput
	}
	if err := validateOIDCURL(input.IssuerURL, allowInsecureLoopback); err != nil || len(input.IssuerURL) > 2048 {
		return providerInput{}, ErrInvalidInput
	}

	domains, err := normalizeEmailDomains(input.AllowedEmailDomains)
	if err != nil {
		return providerInput{}, err
	}
	input.AllowedEmailDomains = domains
	return input, nil
}

// normalizeEmailDomains converts exact Unicode domains to stable ASCII and rejects duplicates or patterns.
func normalizeEmailDomains(values []string) ([]string, error) {
	if len(values) == 0 || len(values) > 100 {
		return nil, ErrInvalidInput
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
		if value == "" || strings.ContainsAny(value, "*@:/\\") {
			return nil, ErrInvalidInput
		}
		ascii, err := idna.Lookup.ToASCII(value)
		if err != nil || len(ascii) > 253 || net.ParseIP(ascii) != nil {
			return nil, ErrInvalidInput
		}
		for _, label := range strings.Split(ascii, ".") {
			if !domainLabelPattern.MatchString(label) {
				return nil, ErrInvalidInput
			}
		}
		if _, exists := seen[ascii]; exists {
			return nil, ErrInvalidInput
		}
		seen[ascii] = struct{}{}
		result = append(result, ascii)
	}
	slices.Sort(result)
	return result, nil
}

// validateOIDCURL requires an absolute credential-free HTTPS URL or a development loopback HTTP URL.
func validateOIDCURL(value string, allowInsecureLoopback bool) error {
	parsed, err := url.Parse(value)
	if err != nil || !parsed.IsAbs() || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ErrInvalidInput
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme != "http" || !allowInsecureLoopback || !isLoopbackHostname(parsed.Hostname()) {
		return ErrInvalidInput
	}
	return nil
}

// isLoopbackHostname reports whether an OIDC development endpoint is local.
func isLoopbackHostname(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// validateDiscoveryMetadata verifies the issuer and all security-sensitive endpoint URLs.
func validateDiscoveryMetadata(expectedIssuer string, metadata DiscoveryMetadata, allowInsecureLoopback bool) error {
	if metadata.Issuer != expectedIssuer {
		return ErrDiscoveryUnavailable
	}
	for _, endpoint := range []string{metadata.AuthorizationEndpoint, metadata.TokenEndpoint, metadata.JWKSURI} {
		if endpoint == "" || len(endpoint) > 2048 || validateOIDCURL(endpoint, allowInsecureLoopback) != nil {
			return ErrDiscoveryUnavailable
		}
	}
	return nil
}
