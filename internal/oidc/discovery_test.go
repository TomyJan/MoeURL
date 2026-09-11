package oidc

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestHTTPDiscovererLoadsValidatedMetadata verifies standard discovery data is normalized into the persisted endpoint set.
func TestHTTPDiscovererLoadsValidatedMetadata(t *testing.T) {
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/.well-known/openid-configuration" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{
			"issuer": %q,
			"authorization_endpoint": %q,
			"token_endpoint": %q,
			"jwks_uri": %q
		}`, server.URL, server.URL+"/authorize", server.URL+"/token", server.URL+"/jwks")
	}))
	t.Cleanup(server.Close)

	discoverer := NewHTTPDiscoverer(server.Client(), true)
	metadata, err := discoverer.Discover(t.Context(), server.URL)
	if err != nil {
		t.Fatalf("discover provider: %v", err)
	}
	if metadata.Issuer != server.URL || metadata.AuthorizationEndpoint != server.URL+"/authorize" || metadata.TokenEndpoint != server.URL+"/token" || metadata.JWKSURI != server.URL+"/jwks" {
		t.Fatalf("metadata = %#v", metadata)
	}
}

// TestHTTPDiscovererRejectsIssuerMismatch verifies discovery cannot redirect identity trust to another issuer.
func TestHTTPDiscovererRejectsIssuerMismatch(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"issuer":"https://other.example.com",
			"authorization_endpoint":"https://other.example.com/authorize",
			"token_endpoint":"https://other.example.com/token",
			"jwks_uri":"https://other.example.com/jwks"
		}`))
	}))
	t.Cleanup(server.Close)

	discoverer := NewHTTPDiscoverer(server.Client(), true)
	if _, err := discoverer.Discover(t.Context(), server.URL); err == nil {
		t.Fatal("expected issuer mismatch to fail discovery")
	}
}

// TestValidateDiscoveryMetadataRejectsUnsafeOrIncompleteEndpoints verifies only trusted protocol endpoints are persisted.
func TestValidateDiscoveryMetadataRejectsUnsafeOrIncompleteEndpoints(t *testing.T) {
	valid := DiscoveryMetadata{
		Issuer:                "https://id.example.com",
		AuthorizationEndpoint: "https://id.example.com/authorize",
		TokenEndpoint:         "https://id.example.com/token",
		JWKSURI:               "https://id.example.com/jwks",
	}
	for _, test := range []struct {
		name   string
		mutate func(*DiscoveryMetadata)
	}{
		{name: "issuer mismatch", mutate: func(value *DiscoveryMetadata) { value.Issuer = "https://other.example.com" }},
		{name: "missing authorization endpoint", mutate: func(value *DiscoveryMetadata) { value.AuthorizationEndpoint = "" }},
		{name: "HTTP token endpoint", mutate: func(value *DiscoveryMetadata) { value.TokenEndpoint = "http://id.example.com/token" }},
		{name: "JWKS userinfo", mutate: func(value *DiscoveryMetadata) { value.JWKSURI = "https://user@id.example.com/jwks" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			metadata := valid
			test.mutate(&metadata)
			if err := validateDiscoveryMetadata("https://id.example.com", metadata, false); err == nil {
				t.Fatal("expected discovery metadata validation error")
			}
		})
	}
}

// TestHTTPDiscovererRejectsUntrustedResponses verifies bounded failure for malformed provider metadata.
func TestHTTPDiscovererRejectsUntrustedResponses(t *testing.T) {
	if NewHTTPDiscoverer(nil, false).client == nil {
		t.Fatal("nil discovery client was not defaulted")
	}
	if _, err := NewHTTPDiscoverer(http.DefaultClient, false).Discover(t.Context(), "http://remote.example.com"); !errors.Is(err, ErrDiscoveryUnavailable) {
		t.Fatalf("unsafe issuer error = %v", err)
	}

	for _, test := range []struct {
		name   string
		status int
		body   string
	}{
		{name: "status", status: http.StatusBadGateway, body: `{}`},
		{name: "oversized", status: http.StatusOK, body: strings.Repeat("x", maxDiscoveryDocumentBytes+1)},
		{name: "invalid JSON", status: http.StatusOK, body: `{`},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(test.status)
				_, _ = io.WriteString(w, test.body)
			}))
			t.Cleanup(server.Close)
			if _, err := NewHTTPDiscoverer(server.Client(), true).Discover(t.Context(), server.URL); !errors.Is(err, ErrDiscoveryUnavailable) {
				t.Fatalf("discovery error = %v", err)
			}
		})
	}

	for _, test := range []struct {
		name string
		body io.ReadCloser
	}{
		{name: "transport", body: nil},
		{name: "read", body: failingDiscoveryBody{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := &http.Client{Transport: discoveryRoundTripper(func(*http.Request) (*http.Response, error) {
				if test.body == nil {
					return nil, errors.New("network unavailable")
				}
				return &http.Response{StatusCode: http.StatusOK, Body: test.body, Header: make(http.Header)}, nil
			})}
			if _, err := NewHTTPDiscoverer(client, false).Discover(t.Context(), "https://id.example.com"); !errors.Is(err, ErrDiscoveryUnavailable) {
				t.Fatalf("discovery error = %v", err)
			}
		})
	}
}

type discoveryRoundTripper func(*http.Request) (*http.Response, error)

func (f discoveryRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

type failingDiscoveryBody struct{}

func (failingDiscoveryBody) Read([]byte) (int, error) { return 0, errors.New("read failed") }
func (failingDiscoveryBody) Close() error             { return nil }
