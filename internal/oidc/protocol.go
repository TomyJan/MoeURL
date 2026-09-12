package oidc

import (
	"context"
	"errors"
	"io"
	"net/http"
	"sync"

	coreoidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const maxProtocolResponseBytes int64 = 1 << 20

var errOIDCResponseTooLarge = errors.New("OIDC response exceeds limit")

// StandardProtocol implements Authorization Code flow, PKCE, and signed ID Token verification.
type StandardProtocol struct {
	client        *http.Client
	keySetsMu     sync.Mutex
	remoteKeySets map[string]*coreoidc.RemoteKeySet
}

// NewStandardProtocol creates a protocol client with the supplied bounded HTTP transport.
func NewStandardProtocol(client *http.Client) *StandardProtocol {
	if client == nil {
		client = http.DefaultClient
	}
	boundedClient := *client
	boundedClient.Transport = newBoundedOIDCTransport(client.Transport)
	return &StandardProtocol{client: &boundedClient, remoteKeySets: make(map[string]*coreoidc.RemoteKeySet)}
}

// AuthorizationURL builds a standard OIDC authorization request with PKCE S256.
func (p *StandardProtocol) AuthorizationURL(provider RuntimeProvider, redirectURI string, state string, nonce string, codeChallenge string) string {
	config := p.oauthConfig(provider, redirectURI)
	return config.AuthCodeURL(state,
		oauth2.SetAuthURLParam("nonce", nonce),
		oauth2.SetAuthURLParam("code_challenge", codeChallenge),
		oauth2.SetAuthURLParam("code_challenge_method", "S256"),
	)
}

// ExchangeAndVerify exchanges one code and verifies the returned ID Token before exposing claims.
func (p *StandardProtocol) ExchangeAndVerify(ctx context.Context, provider RuntimeProvider, redirectURI string, code string, codeVerifier string) (IdentityClaims, error) {
	ctx = coreoidc.ClientContext(ctx, p.client)
	config := p.oauthConfig(provider, redirectURI)
	token, err := config.Exchange(ctx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return IdentityClaims{}, ErrLoginFailed
	}
	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || rawIDToken == "" {
		return IdentityClaims{}, ErrLoginFailed
	}
	keySet := p.remoteKeySet(provider.JWKSURI)
	verifier := coreoidc.NewVerifier(provider.IssuerURL, keySet, &coreoidc.Config{ClientID: provider.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return IdentityClaims{}, ErrLoginFailed
	}
	if len(idToken.Audience) != 1 || idToken.Audience[0] != provider.ClientID {
		return IdentityClaims{}, ErrLoginFailed
	}
	var claims struct {
		Subject           string `json:"sub"`
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
		Nonce             string `json:"nonce"`
		AuthorizedParty   string `json:"azp"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return IdentityClaims{}, ErrLoginFailed
	}
	if claims.Subject == "" || (claims.AuthorizedParty != "" && claims.AuthorizedParty != provider.ClientID) {
		return IdentityClaims{}, ErrLoginFailed
	}
	return IdentityClaims{
		Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified,
		Name: claims.Name, PreferredUsername: claims.PreferredUsername, Nonce: claims.Nonce,
	}, nil
}

// remoteKeySet returns the long-lived signing-key cache for one trusted JWKS endpoint.
func (p *StandardProtocol) remoteKeySet(jwksURI string) *coreoidc.RemoteKeySet {
	p.keySetsMu.Lock()
	defer p.keySetsMu.Unlock()
	if keySet := p.remoteKeySets[jwksURI]; keySet != nil {
		return keySet
	}
	keySet := coreoidc.NewRemoteKeySet(coreoidc.ClientContext(context.Background(), p.client), jwksURI)
	p.remoteKeySets[jwksURI] = keySet
	return keySet
}

// oauthConfig maps trusted provider metadata into an OAuth 2.0 client configuration.
func (p *StandardProtocol) oauthConfig(provider RuntimeProvider, redirectURI string) oauth2.Config {
	return oauth2.Config{
		ClientID: provider.ClientID, ClientSecret: provider.ClientSecret, RedirectURL: redirectURI,
		Endpoint: oauth2.Endpoint{AuthURL: provider.AuthorizationEndpoint, TokenURL: provider.TokenEndpoint},
		Scopes:   []string{coreoidc.ScopeOpenID, "email", "profile"},
	}
}

type boundedOIDCTransport struct {
	base http.RoundTripper
}

// newBoundedOIDCTransport limits token and JWKS response bodies before protocol libraries decode them.
func newBoundedOIDCTransport(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return &boundedOIDCTransport{base: base}
}

// RoundTrip wraps successful response bodies with a hard read limit.
func (t *boundedOIDCTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.base.RoundTrip(request)
	if err != nil || response == nil || response.Body == nil {
		return response, err
	}
	response.Body = &boundedOIDCResponseBody{body: response.Body, remaining: maxProtocolResponseBytes}
	return response, nil
}

type boundedOIDCResponseBody struct {
	body      io.ReadCloser
	remaining int64
}

// Read returns a stable error as soon as a response exceeds the permitted body size.
func (b *boundedOIDCResponseBody) Read(buffer []byte) (int, error) {
	if b.remaining < 0 {
		return 0, errOIDCResponseTooLarge
	}
	if int64(len(buffer)) > b.remaining+1 {
		buffer = buffer[:b.remaining+1]
	}
	read, err := b.body.Read(buffer)
	b.remaining -= int64(read)
	if b.remaining < 0 {
		return read, errOIDCResponseTooLarge
	}
	return read, err
}

// Close releases the underlying network response.
func (b *boundedOIDCResponseBody) Close() error {
	return b.body.Close()
}

var _ Protocol = (*StandardProtocol)(nil)
