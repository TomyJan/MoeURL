package oidc

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	coreoidc "github.com/coreos/go-oidc/v3/oidc"
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

// TestBoundedOIDCTransportRejectsOversizedResponse verifies JWKS-style responses cannot be read without a byte bound.
func TestBoundedOIDCTransportRejectsOversizedResponse(t *testing.T) {
	transport := newBoundedOIDCTransport(protocolRoundTripper(func(*http.Request) (*http.Response, error) {
		return &http.Response{
			StatusCode: http.StatusOK,
			Header:     make(http.Header),
			Body:       io.NopCloser(strings.NewReader(strings.Repeat("x", int(maxProtocolResponseBytes+1)))),
		}, nil
	}))
	response, err := transport.RoundTrip(httptest.NewRequest(http.MethodGet, "https://id.example.com/jwks", nil))
	if err != nil {
		t.Fatalf("round trip response: %v", err)
	}
	defer response.Body.Close()
	_, err = io.ReadAll(response.Body)
	if !errors.Is(err, errOIDCResponseTooLarge) {
		t.Fatalf("read oversized response error = %v", err)
	}
	if _, err := response.Body.Read(make([]byte, 1)); !errors.Is(err, errOIDCResponseTooLarge) {
		t.Fatalf("repeat oversized response read error = %v", err)
	}
}

// TestBoundedOIDCTransportPreservesTransportFailures verifies response wrapping does not hide base transport outcomes.
func TestBoundedOIDCTransportPreservesTransportFailures(t *testing.T) {
	wantErr := errors.New("transport unavailable")
	for _, result := range []struct {
		response *http.Response
		err      error
	}{
		{err: wantErr},
		{},
		{response: &http.Response{StatusCode: http.StatusNoContent}},
	} {
		transport := newBoundedOIDCTransport(protocolRoundTripper(func(*http.Request) (*http.Response, error) {
			return result.response, result.err
		}))
		response, err := transport.RoundTrip(httptest.NewRequest(http.MethodGet, "https://id.example.com/jwks", nil))
		if response != result.response || !errors.Is(err, result.err) {
			t.Fatalf("round trip = response %#v error %v", response, err)
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

// TestStandardProtocolRejectsUntrustedAudienceAndAuthorizedParty verifies tokens are exclusively issued to this client.
func TestStandardProtocolRejectsUntrustedAudienceAndAuthorizedParty(t *testing.T) {
	for _, claims := range []map[string]any{
		{"aud": []string{"client-id", "other-client"}},
		{"aud": "client-id", "azp": "other-client"},
	} {
		if err := exchangeProtocolTokenWithClaims(t, claims); !errors.Is(err, ErrLoginFailed) {
			t.Fatalf("claims %#v error = %v, want ErrLoginFailed", claims, err)
		}
	}
}

// TestStandardProtocolRejectsInvalidTokenAndClaimResponses verifies every untrusted token boundary fails closed.
func TestStandardProtocolRejectsInvalidTokenAndClaimResponses(t *testing.T) {
	if NewStandardProtocol(nil).client == nil {
		t.Fatal("nil protocol client was not defaulted")
	}
	for _, test := range []struct {
		name      string
		tokenMode string
	}{
		{name: "token endpoint", tokenMode: "endpoint-error"},
		{name: "non-string ID token", tokenMode: "non-string"},
		{name: "invalid ID token", tokenMode: "invalid"},
		{name: "missing expiry", tokenMode: "missing-exp"},
		{name: "expired token", tokenMode: "expired-exp"},
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
					case "missing-exp", "expired-exp", "claim-type", "empty-subject":
						claims := map[string]any{
							"iss": server.URL, "aud": "client-id", "sub": "subject",
							"exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Add(-time.Minute).Unix(),
							"nonce": "nonce", "email": "person@example.com", "email_verified": true,
						}
						switch test.tokenMode {
						case "missing-exp":
							delete(claims, "exp")
						case "expired-exp":
							claims["exp"] = time.Now().Add(-time.Hour).Unix()
						case "claim-type":
							claims["email_verified"] = "yes"
						case "empty-subject":
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

// TestStandardProtocolCachesRemoteKeySets verifies JWKS caches are shared per endpoint under concurrency.
func TestStandardProtocolCachesRemoteKeySets(t *testing.T) {
	protocol := NewStandardProtocol(nil)
	const sharedURI = "https://id.example.com/jwks"

	first := protocol.remoteKeySet(sharedURI)
	if next := protocol.remoteKeySet(sharedURI); next != first {
		t.Fatal("same JWKS URI did not reuse its remote key set")
	}
	if other := protocol.remoteKeySet("https://other.example.com/jwks"); other == first {
		t.Fatal("different JWKS URIs shared one remote key set")
	}

	const workers = 16
	results := make(chan *coreoidc.RemoteKeySet, workers)
	var wait sync.WaitGroup
	wait.Add(workers)
	for range workers {
		go func() {
			defer wait.Done()
			results <- protocol.remoteKeySet(sharedURI)
		}()
	}
	wait.Wait()
	close(results)
	for result := range results {
		if result != first {
			t.Fatal("concurrent lookup created a duplicate remote key set")
		}
	}
}

// exchangeProtocolTokenWithClaims signs one otherwise valid token with selected audience claims.
func exchangeProtocolTokenWithClaims(t *testing.T, overrides map[string]any) error {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate signing key: %v", err)
	}
	const keyID = "test-key"
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			claims := map[string]any{
				"iss": server.URL, "aud": "client-id", "sub": "subject", "exp": time.Now().Add(time.Hour).Unix(),
				"iat": time.Now().Add(-time.Minute).Unix(), "nonce": "nonce", "email": "person@example.com", "email_verified": true,
			}
			for key, value := range overrides {
				claims[key] = value
			}
			signer, signErr := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: privateKey}, &jose.SignerOptions{ExtraHeaders: map[jose.HeaderKey]any{jose.HeaderKey("kid"): keyID}})
			if signErr != nil {
				t.Fatalf("create signer: %v", signErr)
			}
			raw, signErr := jwt.Signed(signer).Claims(claims).Serialize()
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
	t.Cleanup(server.Close)

	_, err = NewStandardProtocol(server.Client()).ExchangeAndVerify(t.Context(), RuntimeProvider{
		IssuerURL: server.URL, ClientID: "client-id", ClientSecret: "secret",
		TokenEndpoint: server.URL + "/token", JWKSURI: server.URL + "/jwks",
	}, "https://links.example.com/callback", "code", "verifier")
	return err
}

type protocolRoundTripper func(*http.Request) (*http.Response, error)

// RoundTrip adapts a function into an HTTP transport for protocol tests.
func (f protocolRoundTripper) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}
