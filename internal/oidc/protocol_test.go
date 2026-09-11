package oidc

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// TestStandardProtocolAuthorizationURLBuildsStandardOIDCRequest verifies the browser request uses PKCE and standard scopes.
func TestStandardProtocolAuthorizationURLBuildsStandardOIDCRequest(t *testing.T) {
	protocol := NewStandardProtocol(http.DefaultClient)
	location := protocol.AuthorizationURL(RuntimeProvider{
		ClientID: "client-id", AuthorizationEndpoint: "https://id.example.com/authorize",
	}, "https://links.example.com/callback", "state-value", "nonce-value", "challenge-value")
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatalf("parse authorization URL: %v", err)
	}
	query := parsed.Query()
	for key, want := range map[string]string{
		"client_id": "client-id", "redirect_uri": "https://links.example.com/callback",
		"response_type": "code", "scope": "openid email profile", "state": "state-value",
		"nonce": "nonce-value", "code_challenge": "challenge-value", "code_challenge_method": "S256",
	} {
		if got := query.Get(key); got != want {
			t.Fatalf("%s = %q, want %q", key, got, want)
		}
	}
}

// TestStandardProtocolVerifiesSignedIDTokenClaims exercises token exchange and remote JWKS verification together.
func TestStandardProtocolVerifiesSignedIDTokenClaims(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	keyID := "test-key"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			signer, signErr := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privateKey}, &jose.SignerOptions{ExtraHeaders: map[jose.HeaderKey]any{jose.HeaderKey("kid"): keyID}})
			if signErr != nil {
				t.Fatalf("create signer: %v", signErr)
			}
			raw, signErr := jwt.Signed(signer).Claims(map[string]any{
				"iss": server.URL, "aud": "client-id", "sub": "subject", "exp": time.Now().Add(time.Hour).Unix(),
				"iat": time.Now().Add(-time.Minute).Unix(), "nonce": "nonce", "email": "person@example.com",
				"email_verified": true, "name": "Person",
			}).Serialize()
			if signErr != nil {
				t.Fatalf("sign ID token: %v", signErr)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "token", "token_type": "Bearer", "id_token": raw})
		case "/jwks":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &privateKey.PublicKey, KeyID: keyID, Algorithm: string(jose.RS256), Use: "sig"}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	claims, err := NewStandardProtocol(server.Client()).ExchangeAndVerify(t.Context(), RuntimeProvider{
		IssuerURL: server.URL, ClientID: "client-id", ClientSecret: "secret", TokenEndpoint: server.URL + "/token", JWKSURI: server.URL + "/jwks",
	}, "https://links.example.com/callback", "code", "verifier")
	if err != nil {
		t.Fatalf("exchange signed ID token: %v", err)
	}
	if claims.Subject != "subject" || claims.Email != "person@example.com" || !claims.EmailVerified || claims.Nonce != "nonce" {
		t.Fatalf("verified claims = %#v", claims)
	}
}

// TestStandardProtocolRejectsTokenResponseWithoutIDToken verifies access tokens alone cannot authenticate a user.
func TestStandardProtocolRejectsTokenResponseWithoutIDToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse token request: %v", err)
		}
		if r.Form.Get("code_verifier") != "verifier-value" || r.Form.Get("code") != "code-value" {
			t.Fatalf("token request = %#v", r.Form)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"token","token_type":"Bearer","expires_in":3600}`))
	}))
	defer server.Close()

	protocol := NewStandardProtocol(server.Client())
	_, err := protocol.ExchangeAndVerify(context.Background(), RuntimeProvider{
		IssuerURL: "https://id.example.com", ClientID: "client-id", ClientSecret: "client-secret",
		TokenEndpoint: server.URL, JWKSURI: server.URL + "/jwks",
	}, "https://links.example.com/callback", "code-value", "verifier-value")
	if err == nil {
		t.Fatal("exchange accepted response without ID token")
	}
}

// TestStandardProtocolRejectsInvalidTokenAndClaimResponses verifies every untrusted token boundary fails closed.
func TestStandardProtocolRejectsInvalidTokenAndClaimResponses(t *testing.T) {
	if NewStandardProtocol(nil).client != http.DefaultClient {
		t.Fatal("nil protocol client was not defaulted")
	}
	for _, test := range []struct {
		name      string
		tokenMode string
	}{
		{name: "token endpoint", tokenMode: "endpoint-error"},
		{name: "non-string ID token", tokenMode: "non-string"},
		{name: "invalid ID token", tokenMode: "invalid"},
		{name: "invalid claim type", tokenMode: "claim-type"},
		{name: "empty subject", tokenMode: "empty-subject"},
	} {
		t.Run(test.name, func(t *testing.T) {
			privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
			if err != nil {
				t.Fatalf("generate signing key: %v", err)
			}
			const keyID = "test-key"
			var server *httptest.Server
			server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/token":
					if test.tokenMode == "endpoint-error" {
						http.Error(w, "unavailable", http.StatusBadGateway)
						return
					}
					var raw any = "not-a-token"
					switch test.tokenMode {
					case "non-string":
						raw = 42
					case "claim-type", "empty-subject":
						claims := map[string]any{
							"iss": server.URL, "aud": "client-id", "sub": "subject",
							"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Add(-time.Minute).Unix(),
							"nonce": "nonce", "email": "person@example.com", "email_verified": true,
						}
						if test.tokenMode == "claim-type" {
							claims["email_verified"] = "yes"
						} else {
							claims["sub"] = ""
						}
						signer, signErr := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privateKey}, &jose.SignerOptions{ExtraHeaders: map[jose.HeaderKey]any{jose.HeaderKey("kid"): keyID}})
						if signErr != nil {
							t.Fatalf("create signer: %v", signErr)
						}
						raw, signErr = jwt.Signed(signer).Claims(claims).Serialize()
						if signErr != nil {
							t.Fatalf("sign token: %v", signErr)
						}
					}
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "token", "token_type": "Bearer", "id_token": raw})
				case "/jwks":
					w.Header().Set("Content-Type", "application/json")
					_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &privateKey.PublicKey, KeyID: keyID, Algorithm: string(jose.RS256), Use: "sig"}}})
				default:
					http.NotFound(w, r)
				}
			}))
			t.Cleanup(server.Close)

			_, err = NewStandardProtocol(server.Client()).ExchangeAndVerify(t.Context(), RuntimeProvider{
				IssuerURL: server.URL, ClientID: "client-id", ClientSecret: "secret",
				TokenEndpoint: server.URL + "/token", JWKSURI: server.URL + "/jwks",
			}, "https://links.example.com/callback", "code", "verifier")
			if !errors.Is(err, ErrLoginFailed) {
				t.Fatalf("protocol error = %v", err)
			}
		})
	}
}
