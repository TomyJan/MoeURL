package oidc

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestLoginServiceStartPersistsBoundStateAndBuildsPKCEAuthorization verifies the OIDC start boundary.
func TestLoginServiceStartPersistsBoundStateAndBuildsPKCEAuthorization(t *testing.T) {
	box := testSecretBox(t)
	provider := testRuntimeProviderRow(t, box)
	store := &loginStoreStub{provider: provider}
	protocol := &protocolStub{authorizationLocation: "https://id.example.com/authorize?request=1"}
	service := newLoginService(store, protocol, &identityResolverStub{}, &sessionCreatorStub{}, box, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{7}, 128)))
	service.now = func() time.Time { return time.Date(2026, time.September, 11, 1, 2, 3, 0, time.UTC) }

	result, err := service.Start(t.Context(), "company", "/analytics?shortLinkId=abc")
	if err != nil {
		t.Fatalf("start OIDC login: %v", err)
	}
	if result.Location != protocol.authorizationLocation {
		t.Fatalf("start location = %q", result.Location)
	}
	if protocol.redirectURI != "https://links.example.com/api/v1/auth/oidc/company/callback" || protocol.state == "" || protocol.nonce == "" || protocol.codeChallenge == "" {
		t.Fatalf("authorization inputs = %#v", protocol)
	}
	wantStateHash := sha256.Sum256([]byte(protocol.state))
	if !bytes.Equal(store.createdAttempt.StateHash, wantStateHash[:]) {
		t.Fatalf("stored state hash = %x", store.createdAttempt.StateHash)
	}
	recordID := base64.RawURLEncoding.EncodeToString(wantStateHash[:])
	verifier, err := box.Open(loginVerifierPurpose, recordID, store.createdAttempt.VerifierCiphertext)
	if err != nil {
		t.Fatalf("open stored verifier: value=%q err=%v", verifier, err)
	}
	if bytes.Contains(store.createdAttempt.VerifierCiphertext, verifier) {
		t.Fatal("stored verifier contains plaintext")
	}
	wantChallenge := sha256.Sum256(verifier)
	if protocol.codeChallenge != base64.RawURLEncoding.EncodeToString(wantChallenge[:]) {
		t.Fatalf("code challenge = %q", protocol.codeChallenge)
	}
	if store.createdAttempt.ReturnPath != "/analytics?shortLinkId=abc" {
		t.Fatalf("stored return path = %q", store.createdAttempt.ReturnPath)
	}
	if !store.createdAttempt.ExpiresAt.Time.Equal(service.now().Add(loginAttemptTTL)) {
		t.Fatalf("attempt expiry = %s", store.createdAttempt.ExpiresAt.Time)
	}
	wantBindingHash := sha256.Sum256([]byte(result.BrowserBinding))
	if result.BrowserBinding == "" || !bytes.Equal(store.createdAttempt.BrowserBindingHash, wantBindingHash[:]) {
		t.Fatalf("browser binding was not persisted as a digest: result=%q stored=%x", result.BrowserBinding, store.createdAttempt.BrowserBindingHash)
	}
	if result.BindingCookieName != browserBindingCookieName(protocol.state) {
		t.Fatalf("binding cookie name = %q", result.BindingCookieName)
	}
}

// TestLoginServiceStartFallsBackFromUnsafeReturnPaths verifies authorization cannot create an open redirect.
func TestLoginServiceStartFallsBackFromUnsafeReturnPaths(t *testing.T) {
	for _, returnPath := range []string{"", "https://evil.example", "//evil.example", `/\\evil`, "/path\nheader", "relative"} {
		t.Run(returnPath, func(t *testing.T) {
			box := testSecretBox(t)
			store := &loginStoreStub{provider: testRuntimeProviderRow(t, box)}
			service := newLoginService(store, &protocolStub{authorizationLocation: "https://id.example.com"}, &identityResolverStub{}, &sessionCreatorStub{}, box, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{3}, 128)))
			if _, err := service.Start(t.Context(), "company", returnPath); err != nil {
				t.Fatalf("start OIDC login: %v", err)
			}
			if store.createdAttempt.ReturnPath != defaultOIDCReturnPath {
				t.Fatalf("return path = %q, want fallback", store.createdAttempt.ReturnPath)
			}
		})
	}
}

// TestLoginServiceStartRejectsSaturatedAdmission verifies start overload does not reach persistence.
func TestLoginServiceStartRejectsSaturatedAdmission(t *testing.T) {
	box := testSecretBox(t)
	store := &loginStoreStub{provider: testRuntimeProviderRow(t, box)}
	service := newLoginService(store, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, box, "https://links.example.com", nil)
	service.startSlots = make(chan struct{}, 1)
	service.startSlots <- struct{}{}

	if _, err := service.Start(t.Context(), "company", "/console"); !errors.Is(err, ErrLoginFailed) {
		t.Fatalf("saturated start error = %v", err)
	}
	if store.createdAttempt.StateHash != nil {
		t.Fatal("saturated start persisted an attempt")
	}
}

// TestLoginServiceStartStopsOnRandomnessEncryptionAndPersistenceFailures verifies partial attempts never proceed.
func TestLoginServiceStartStopsOnRandomnessEncryptionAndPersistenceFailures(t *testing.T) {
	for _, size := range []int{0, loginRandomBytes, 2 * loginRandomBytes, 3 * loginRandomBytes} {
		box := testSecretBox(t)
		store := &loginStoreStub{provider: testRuntimeProviderRow(t, box)}
		service := newLoginService(store, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, box, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{1}, size)))
		if _, err := service.Start(t.Context(), "company", "/console"); !errors.Is(err, ErrLoginFailed) {
			t.Fatalf("random source size %d error = %v", size, err)
		}
		if store.createdAttempt.StateHash != nil {
			t.Fatalf("random source size %d persisted attempt", size)
		}
	}

	sharedKey := bytes.Repeat([]byte{2}, 32)
	validBox, err := newSecretBox(sharedKey, bytes.NewReader(bytes.Repeat([]byte{3}, 64)))
	if err != nil {
		t.Fatalf("create provider secret box: %v", err)
	}
	failingBox, err := newSecretBox(sharedKey, errorReader{})
	if err != nil {
		t.Fatalf("create failing box: %v", err)
	}
	store := &loginStoreStub{provider: testRuntimeProviderRow(t, validBox)}
	service := newLoginService(store, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, failingBox, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{1}, 128)))
	if _, err := service.Start(t.Context(), "company", "/console"); !errors.Is(err, ErrSecretUnavailable) {
		t.Fatalf("encryption error = %v", err)
	}

	store = &loginStoreStub{provider: testRuntimeProviderRow(t, validBox), createErr: errors.New("database unavailable")}
	service = newLoginService(store, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, validBox, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{1}, 128)))
	if _, err := service.Start(t.Context(), "company", "/console"); !errors.Is(err, store.createErr) {
		t.Fatalf("persistence error = %v", err)
	}
}

// TestLoginServiceCallbackConsumesStateVerifiesNonceAndCreatesSession verifies the successful callback order.
func TestLoginServiceCallbackConsumesStateVerifiesNonceAndCreatesSession(t *testing.T) {
	fixture := newCallbackFixture(t)

	result, err := fixture.service.Callback(t.Context(), "company", "authorization-code", fixture.state, fixture.browserBinding)
	if err != nil {
		t.Fatalf("complete OIDC callback: %v", err)
	}
	if result.ReturnPath != "/console" || result.Session.ID != "session-id" {
		t.Fatalf("callback result = %#v", result)
	}
	if fixture.protocol.code != "authorization-code" || fixture.protocol.codeVerifier != fixture.verifier {
		t.Fatalf("exchange inputs = %#v", fixture.protocol)
	}
	if fixture.identities.claims.Subject != "external-subject" || fixture.sessions.userID != "user-id" {
		t.Fatalf("identity/session inputs: claims=%#v userID=%q", fixture.identities.claims, fixture.sessions.userID)
	}
	if fixture.store.consumeCalls != 1 {
		t.Fatalf("consume calls = %d", fixture.store.consumeCalls)
	}
}

// TestLoginServiceCallbackRejectsInvalidOrReplayedState verifies one-time state closes before external exchange.
func TestLoginServiceCallbackRejectsInvalidOrReplayedState(t *testing.T) {
	fixture := newCallbackFixture(t)
	fixture.store.consumeErr = pgx.ErrNoRows
	if _, err := fixture.service.Callback(t.Context(), "company", "code", fixture.state, fixture.browserBinding); !errors.Is(err, ErrLoginFailed) {
		t.Fatalf("missing state callback error = %v", err)
	}
	if fixture.protocol.exchangeCalls != 0 {
		t.Fatalf("exchange calls = %d", fixture.protocol.exchangeCalls)
	}
}

// TestLoginServiceCallbackRejectsExpiredProviderMismatchAndNonceMismatch verifies state binding before identity creation.
func TestLoginServiceCallbackRejectsExpiredProviderMismatchAndNonceMismatch(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*callbackFixture)
	}{
		{name: "expired", mutate: func(value *callbackFixture) {
			value.store.attempt.ExpiresAt.Time = value.service.now().Add(-time.Second)
		}},
		{name: "provider mismatch", mutate: func(value *callbackFixture) { value.store.provider.ID = uuidToPGUUID(uuid.New()) }},
		{name: "nonce mismatch", mutate: func(value *callbackFixture) { value.protocol.claims.Nonce = "other-nonce" }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			fixture := newCallbackFixture(t)
			test.mutate(fixture)
			if _, err := fixture.service.Callback(t.Context(), "company", "code", fixture.state, fixture.browserBinding); !errors.Is(err, ErrLoginFailed) {
				t.Fatalf("callback error = %v", err)
			}
			if fixture.sessions.calls != 0 {
				t.Fatalf("session calls = %d", fixture.sessions.calls)
			}
		})
	}
}

// TestLoginServiceCallbackRejectsMissingOrMismatchedBrowserBinding verifies a callback is bound to its initiating browser.
func TestLoginServiceCallbackRejectsMissingOrMismatchedBrowserBinding(t *testing.T) {
	for _, binding := range []string{"", "binding-from-another-browser"} {
		fixture := newCallbackFixture(t)
		if _, err := fixture.service.Callback(t.Context(), "company", "code", fixture.state, binding); !errors.Is(err, ErrLoginFailed) {
			t.Fatalf("binding %q callback error = %v", binding, err)
		}
		if fixture.store.consumeCalls != 1 || fixture.protocol.exchangeCalls != 0 || fixture.sessions.calls != 0 {
			t.Fatalf("invalid binding reached dependencies: consume=%d exchange=%d session=%d", fixture.store.consumeCalls, fixture.protocol.exchangeCalls, fixture.sessions.calls)
		}
	}
}

// TestLoginServiceCallbackRejectsSaturatedAdmission verifies callback overload is rejected before state consumption.
func TestLoginServiceCallbackRejectsSaturatedAdmission(t *testing.T) {
	fixture := newCallbackFixture(t)
	fixture.service.callbackSlots = make(chan struct{}, 1)
	fixture.service.callbackSlots <- struct{}{}

	if _, err := fixture.service.Callback(t.Context(), "company", "code", fixture.state, fixture.browserBinding); !errors.Is(err, ErrLoginFailed) {
		t.Fatalf("saturated callback error = %v", err)
	}
	if fixture.store.consumeCalls != 0 || fixture.protocol.exchangeCalls != 0 || fixture.sessions.calls != 0 {
		t.Fatalf("saturated callback reached dependencies: consume=%d exchange=%d session=%d", fixture.store.consumeCalls, fixture.protocol.exchangeCalls, fixture.sessions.calls)
	}
}

// TestLoginServiceCallbackStopsAtEachFailedBoundary verifies no Session is issued after callback failure.
func TestLoginServiceCallbackStopsAtEachFailedBoundary(t *testing.T) {
	for _, test := range []struct {
		name   string
		code   string
		state  string
		mutate func(*callbackFixture)
		want   error
	}{
		{name: "missing code", state: "callback-state", want: ErrLoginFailed},
		{name: "missing state", code: "code", want: ErrLoginFailed},
		{name: "invalid verifier", code: "code", state: "callback-state", mutate: func(value *callbackFixture) { value.store.attempt.VerifierCiphertext = []byte{1} }, want: ErrLoginFailed},
		{name: "protocol", code: "code", state: "callback-state", mutate: func(value *callbackFixture) { value.protocol.exchangeErr = errors.New("protocol failed") }, want: ErrLoginFailed},
		{name: "identity", code: "code", state: "callback-state", mutate: func(value *callbackFixture) { value.identities.err = ErrIdentityNotAllowed }, want: ErrIdentityNotAllowed},
		{name: "session", code: "code", state: "callback-state", mutate: func(value *callbackFixture) { value.sessions.err = errors.New("session unavailable") }, want: nil},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := newCallbackFixture(t)
			if test.mutate != nil {
				test.mutate(fixture)
			}
			_, err := fixture.service.Callback(t.Context(), "company", test.code, test.state, fixture.browserBinding)
			if test.want != nil && !errors.Is(err, test.want) {
				t.Fatalf("callback error = %v, want %v", err, test.want)
			}
			if test.want == nil && err == nil {
				t.Fatal("callback unexpectedly succeeded")
			}
		})
	}
}

// TestLoginServiceRejectsUnavailableProviderData verifies stored runtime configuration fails closed.
func TestLoginServiceRejectsUnavailableProviderData(t *testing.T) {
	box := testSecretBox(t)
	valid := testRuntimeProviderRow(t, box)
	for _, test := range []struct {
		name   string
		mutate func(*loginStoreStub)
		want   error
	}{
		{name: "query", mutate: func(value *loginStoreStub) { value.providerErr = errors.New("database unavailable") }, want: ErrProviderNotFound},
		{name: "invalid id", mutate: func(value *loginStoreStub) { value.provider.ID.Valid = false }, want: ErrProviderNotFound},
		{name: "secret", mutate: func(value *loginStoreStub) { value.provider.ClientSecretCiphertext = []byte{1} }, want: ErrSecretUnavailable},
		{name: "domains", mutate: func(value *loginStoreStub) { value.provider.AllowedEmailDomains = []byte(`{}`) }, want: ErrRuntimeUnavailable},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &loginStoreStub{provider: valid}
			test.mutate(store)
			service := newLoginService(store, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, box, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{1}, 96)))
			if _, err := service.Start(t.Context(), "company", "/console"); !errors.Is(err, test.want) {
				t.Fatalf("provider data error = %v, want %v", err, test.want)
			}
		})
	}
}

// TestValidateEnabledProviderRuntimeRejectsCorruptedRows verifies startup validation covers every persisted runtime boundary.
func TestValidateEnabledProviderRuntimeRejectsCorruptedRows(t *testing.T) {
	box := testSecretBox(t)
	valid := testRuntimeProviderRow(t, box)
	if err := ValidateEnabledProviderRuntime(nil, box, false); err != nil {
		t.Fatalf("validate empty provider list: %v", err)
	}
	if err := ValidateEnabledProviderRuntime([]sqlc.OidcProvider{valid}, box, false); err != nil {
		t.Fatalf("validate provider runtime: %v", err)
	}
	for _, mutate := range []func(*sqlc.OidcProvider){
		func(row *sqlc.OidcProvider) { row.ID.Valid = false },
		func(row *sqlc.OidcProvider) { row.AllowedEmailDomains = []byte(`{}`) },
		func(row *sqlc.OidcProvider) { row.ClientID = "" },
		func(row *sqlc.OidcProvider) { row.JwksUri = "http://remote.example.com/jwks" },
		func(row *sqlc.OidcProvider) { row.ClientSecretCiphertext = []byte{1} },
	} {
		row := valid
		mutate(&row)
		if err := ValidateEnabledProviderRuntime([]sqlc.OidcProvider{row}, box, false); !errors.Is(err, ErrRuntimeUnavailable) {
			t.Fatalf("invalid provider %#v error = %v", row, err)
		}
	}
}

// TestNewLoginServiceUsesProductionDefaults verifies the exported constructor establishes bounded state.
func TestNewLoginServiceUsesProductionDefaults(t *testing.T) {
	service := NewLoginService(nil, &protocolStub{}, &identityResolverStub{}, &sessionCreatorStub{}, testSecretBox(t), "https://links.example.com/")
	if service.store == nil || service.random == nil || service.publicBaseURL != "https://links.example.com" {
		t.Fatalf("production login service = %#v", service)
	}
}

type callbackFixture struct {
	service        *LoginService
	store          *loginStoreStub
	protocol       *protocolStub
	identities     *identityResolverStub
	sessions       *sessionCreatorStub
	state          string
	verifier       string
	browserBinding string
}

// newCallbackFixture assembles a valid consumed-attempt callback scenario.
func newCallbackFixture(t *testing.T) *callbackFixture {
	t.Helper()
	box := testSecretBox(t)
	provider := testRuntimeProviderRow(t, box)
	state := "callback-state"
	stateHash := sha256.Sum256([]byte(state))
	nonce := "callback-nonce"
	nonceHash := sha256.Sum256([]byte(nonce))
	verifier := "callback-verifier"
	browserBinding := "callback-browser-binding"
	browserBindingHash := sha256.Sum256([]byte(browserBinding))
	recordID := base64.RawURLEncoding.EncodeToString(stateHash[:])
	ciphertext, err := box.Seal(loginVerifierPurpose, recordID, []byte(verifier))
	if err != nil {
		t.Fatalf("seal callback verifier: %v", err)
	}
	now := time.Date(2026, time.September, 11, 1, 2, 3, 0, time.UTC)
	store := &loginStoreStub{
		provider: provider,
		attempt: sqlc.OidcLoginAttempt{
			StateHash: stateHash[:], ProviderID: provider.ID, NonceHash: nonceHash[:],
			VerifierCiphertext: ciphertext, BrowserBindingHash: browserBindingHash[:], ReturnPath: "/console",
			ExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
		},
	}
	protocol := &protocolStub{claims: IdentityClaims{
		Subject: "external-subject", Email: "person@example.com", EmailVerified: true,
		Name: "Person", Nonce: nonce,
	}}
	identities := &identityResolverStub{user: auth.CurrentUser{ID: "user-id", Username: "oidc-company-user", Nickname: "Person", GroupKey: "user"}}
	sessions := &sessionCreatorStub{session: auth.Session{ID: "session-id", UserID: "user-id", ExpiresAt: now.Add(time.Hour)}}
	service := newLoginService(store, protocol, identities, sessions, box, "https://links.example.com", bytes.NewReader(bytes.Repeat([]byte{4}, 96)))
	service.now = func() time.Time { return now }
	return &callbackFixture{service: service, store: store, protocol: protocol, identities: identities, sessions: sessions, state: state, verifier: verifier, browserBinding: browserBinding}
}

// testRuntimeProviderRow returns one encrypted provider row accepted by the login service.
func testRuntimeProviderRow(t *testing.T, box *SecretBox) sqlc.OidcProvider {
	t.Helper()
	provider := testProviderRow()
	providerID := uuid.UUID(provider.ID.Bytes).String()
	ciphertext, err := box.Seal(providerSecretPurpose, providerID, []byte("client-secret"))
	if err != nil {
		t.Fatalf("seal provider secret: %v", err)
	}
	provider.ClientSecretCiphertext = ciphertext
	return provider
}

type loginStoreStub struct {
	provider       sqlc.OidcProvider
	providerErr    error
	attempt        sqlc.OidcLoginAttempt
	consumeErr     error
	createErr      error
	createdAttempt sqlc.CreateOIDCLoginAttemptParams
	consumeCalls   int
}

func (s *loginStoreStub) GetEnabledOIDCProviderByKey(context.Context, string) (sqlc.OidcProvider, error) {
	return s.provider, s.providerErr
}

func (s *loginStoreStub) CreateOIDCLoginAttempt(_ context.Context, input sqlc.CreateOIDCLoginAttemptParams) error {
	s.createdAttempt = input
	return s.createErr
}

func (s *loginStoreStub) ConsumeOIDCLoginAttempt(context.Context, []byte) (sqlc.OidcLoginAttempt, error) {
	s.consumeCalls++
	return s.attempt, s.consumeErr
}

type protocolStub struct {
	authorizationLocation string
	claims                IdentityClaims
	exchangeErr           error
	redirectURI           string
	state                 string
	nonce                 string
	codeChallenge         string
	codeVerifier          string
	code                  string
	exchangeCalls         int
}

// AuthorizationURL captures trusted inputs while returning a stable upstream location.
func (p *protocolStub) AuthorizationURL(_ RuntimeProvider, redirectURI string, state string, nonce string, codeChallenge string) string {
	p.redirectURI = redirectURI
	p.state = state
	p.nonce = nonce
	p.codeChallenge = codeChallenge
	return p.authorizationLocation
}

// ExchangeAndVerify captures callback inputs and returns configured verified claims.
func (p *protocolStub) ExchangeAndVerify(_ context.Context, _ RuntimeProvider, redirectURI string, code string, codeVerifier string) (IdentityClaims, error) {
	p.exchangeCalls++
	p.redirectURI = redirectURI
	p.code = code
	p.codeVerifier = codeVerifier
	return p.claims, p.exchangeErr
}

type identityResolverStub struct {
	user   auth.CurrentUser
	err    error
	claims IdentityClaims
}

// ResolveOrCreate captures verified claims and returns a configured local user.
func (s *identityResolverStub) ResolveOrCreate(_ context.Context, _ RuntimeProvider, claims IdentityClaims) (auth.CurrentUser, error) {
	s.claims = claims
	return s.user, s.err
}

type sessionCreatorStub struct {
	session auth.Session
	err     error
	userID  string
	calls   int
}

// Create captures the resolved user and returns a configured session.
func (s *sessionCreatorStub) Create(_ context.Context, userID string) (auth.Session, error) {
	s.calls++
	s.userID = userID
	return s.session, s.err
}
