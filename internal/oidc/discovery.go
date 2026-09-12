package oidc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

const maxDiscoveryDocumentBytes = 1 << 20

// Discoverer loads and validates the standard metadata needed by an OIDC provider.
type Discoverer interface {
	Discover(context.Context, string) (DiscoveryMetadata, error)
}

// HTTPDiscoverer reads OIDC discovery documents through an injected bounded client.
type HTTPDiscoverer struct {
	client                *http.Client
	allowInsecureLoopback bool
}

// NewHTTPDiscoverer creates a discovery client with explicit transport and development policy.
func NewHTTPDiscoverer(client *http.Client, allowInsecureLoopback bool) *HTTPDiscoverer {
	if client == nil {
		client = http.DefaultClient
	}
	return &HTTPDiscoverer{client: client, allowInsecureLoopback: allowInsecureLoopback}
}

// Discover loads one bounded discovery document and rejects mismatched or unsafe endpoints.
func (d *HTTPDiscoverer) Discover(ctx context.Context, issuer string) (DiscoveryMetadata, error) {
	if validateOIDCURL(issuer, d.allowInsecureLoopback) != nil {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	discoveryURL := strings.TrimSuffix(issuer, "/") + "/.well-known/openid-configuration"
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	request.Header.Set("Accept", "application/json")
	response, err := d.client.Do(request)
	if err != nil {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	limited := io.LimitReader(response.Body, maxDiscoveryDocumentBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil || len(body) > maxDiscoveryDocumentBytes {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	var metadata DiscoveryMetadata
	if err := json.Unmarshal(body, &metadata); err != nil {
		return DiscoveryMetadata{}, ErrDiscoveryUnavailable
	}
	if err := validateDiscoveryMetadata(issuer, metadata, d.allowInsecureLoopback); err != nil {
		return DiscoveryMetadata{}, err
	}
	return metadata, nil
}
