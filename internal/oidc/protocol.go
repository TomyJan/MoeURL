package oidc

import (
	"context"
	"net/http"

	coreoidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// StandardProtocol implements Authorization Code flow, PKCE, and signed ID Token verification.
type StandardProtocol struct {
	client *http.Client
}

// NewStandardProtocol creates a protocol client with the supplied bounded HTTP transport.
func NewStandardProtocol(client *http.Client) *StandardProtocol {
	if client == nil {
		client = http.DefaultClient
	}
	return &StandardProtocol{client: client}
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
	keySet := coreoidc.NewRemoteKeySet(ctx, provider.JWKSURI)
	verifier := coreoidc.NewVerifier(provider.IssuerURL, keySet, &coreoidc.Config{ClientID: provider.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return IdentityClaims{}, ErrLoginFailed
	}
	var claims struct {
		Subject           string `json:"sub"`
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		Name              string `json:"name"`
		PreferredUsername string `json:"preferred_username"`
		Nonce             string `json:"nonce"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return IdentityClaims{}, ErrLoginFailed
	}
	if claims.Subject == "" {
		return IdentityClaims{}, ErrLoginFailed
	}
	return IdentityClaims{
		Subject: claims.Subject, Email: claims.Email, EmailVerified: claims.EmailVerified,
		Name: claims.Name, PreferredUsername: claims.PreferredUsername, Nonce: claims.Nonce,
	}, nil
}

// oauthConfig maps trusted provider metadata into an OAuth 2.0 client configuration.
func (p *StandardProtocol) oauthConfig(provider RuntimeProvider, redirectURI string) oauth2.Config {
	return oauth2.Config{
		ClientID: provider.ClientID, ClientSecret: provider.ClientSecret, RedirectURL: redirectURI,
		Endpoint: oauth2.Endpoint{AuthURL: provider.AuthorizationEndpoint, TokenURL: provider.TokenEndpoint},
		Scopes:   []string{coreoidc.ScopeOpenID, "email", "profile"},
	}
}

var _ Protocol = (*StandardProtocol)(nil)
