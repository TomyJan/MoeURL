package oidc

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"time"
	"unicode"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	loginVerifierPurpose                = "login-verifier"
	loginAttemptTTL                     = 5 * time.Minute
	defaultOIDCReturnPath               = "/console"
	loginRandomBytes                    = 32
	loginOperationTimeout               = 10 * time.Second
	defaultStartConcurrency             = 16
	defaultCallbackConcurrency          = 8
	loginAttemptCleanupBatchSize  int32 = 500
	maxLoginAttemptCleanupBatches       = 4
)

// IdentityClaims contains the verified standard claims used for local identity resolution.
type IdentityClaims struct {
	Subject           string
	Email             string
	EmailVerified     bool
	Name              string
	PreferredUsername string
	Nonce             string
}

// RuntimeProvider contains one enabled provider's runtime-only configuration.
type RuntimeProvider struct {
	ID                    pgtype.UUID
	Key                   string
	DisplayName           string
	IssuerURL             string
	ClientID              string
	ClientSecret          string
	AuthorizationEndpoint string
	TokenEndpoint         string
	JWKSURI               string
	AllowedEmailDomains   []string
}

// LoginStart contains the trusted upstream location and short-lived browser correlation data.
type LoginStart struct {
	Location          string
	BrowserBinding    string
	BindingCookieName string
	ExpiresAt         time.Time
}

// LoginCallback contains the local session and validated return path.
type LoginCallback struct {
	Session    auth.Session
	ReturnPath string
}

type loginStore interface {
	GetEnabledOIDCProviderByKey(context.Context, string) (sqlc.OidcProvider, error)
	CreateOIDCLoginAttempt(context.Context, sqlc.CreateOIDCLoginAttemptParams) error
	ConsumeOIDCLoginAttempt(context.Context, []byte) (sqlc.OidcLoginAttempt, error)
}

// Protocol performs standards-compliant authorization and verified token exchange.
type Protocol interface {
	AuthorizationURL(RuntimeProvider, string, string, string, string) string
	ExchangeAndVerify(context.Context, RuntimeProvider, string, string, string) (IdentityClaims, error)
}

// IdentityResolver maps verified external claims to an active local user.
type IdentityResolver interface {
	ResolveOrCreate(context.Context, RuntimeProvider, IdentityClaims) (auth.CurrentUser, error)
}

// SessionCreator persists a local MoeURL session.
type SessionCreator interface {
	Create(context.Context, string) (auth.Session, error)
}

// LoginService coordinates one-time OIDC login attempts and existing MoeURL sessions.
type LoginService struct {
	store         loginStore
	protocol      Protocol
	identities    IdentityResolver
	sessions      SessionCreator
	secrets       *SecretBox
	publicBaseURL string
	random        io.Reader
	now           func() time.Time
	startSlots    chan struct{}
	callbackSlots chan struct{}
}

// newLoginService assembles the coordinator with injectable boundaries for tests.
func newLoginService(store loginStore, oidcProtocol Protocol, identities IdentityResolver, sessions SessionCreator, secrets *SecretBox, publicBaseURL string, randomSource io.Reader) *LoginService {
	if randomSource == nil {
		randomSource = rand.Reader
	}
	return &LoginService{
		store: store, protocol: oidcProtocol, identities: identities, sessions: sessions,
		secrets: secrets, publicBaseURL: strings.TrimSuffix(publicBaseURL, "/"), random: randomSource,
		now:        func() time.Time { return time.Now().UTC() },
		startSlots: make(chan struct{}, defaultStartConcurrency), callbackSlots: make(chan struct{}, defaultCallbackConcurrency),
	}
}

// NewLoginService creates the production OIDC login coordinator.
func NewLoginService(pool *pgxpool.Pool, oidcProtocol Protocol, identities IdentityResolver, sessions SessionCreator, secrets *SecretBox, publicBaseURL string) *LoginService {
	return newLoginService(sqlc.New(pool), oidcProtocol, identities, sessions, secrets, publicBaseURL, rand.Reader)
}

// Start persists an opaque one-time attempt and returns the provider authorization URL.
func (s *LoginService) Start(ctx context.Context, providerKey string, returnPath string) (LoginStart, error) {
	if !acquireLoginSlot(s.startSlots) {
		return LoginStart{}, ErrLoginFailed
	}
	defer releaseLoginSlot(s.startSlots)
	ctx, cancel := context.WithTimeout(ctx, loginOperationTimeout)
	defer cancel()
	provider, err := s.loadProvider(ctx, providerKey)
	if err != nil {
		return LoginStart{}, err
	}
	state, err := s.randomToken()
	if err != nil {
		return LoginStart{}, ErrLoginFailed
	}
	nonce, err := s.randomToken()
	if err != nil {
		return LoginStart{}, ErrLoginFailed
	}
	verifier, err := s.randomToken()
	if err != nil {
		return LoginStart{}, ErrLoginFailed
	}
	browserBinding, err := s.randomToken()
	if err != nil {
		return LoginStart{}, ErrLoginFailed
	}
	stateHash := sha256.Sum256([]byte(state))
	nonceHash := sha256.Sum256([]byte(nonce))
	browserBindingHash := sha256.Sum256([]byte(browserBinding))
	recordID := base64.RawURLEncoding.EncodeToString(stateHash[:])
	ciphertext, err := s.secrets.Seal(loginVerifierPurpose, recordID, []byte(verifier))
	if err != nil {
		return LoginStart{}, err
	}
	if !isSafeReturnPath(returnPath) {
		returnPath = defaultOIDCReturnPath
	}
	expiresAt := s.now().Add(loginAttemptTTL)
	err = s.store.CreateOIDCLoginAttempt(ctx, sqlc.CreateOIDCLoginAttemptParams{
		StateHash: stateHash[:], ProviderID: provider.ID, NonceHash: nonceHash[:], BrowserBindingHash: browserBindingHash[:],
		VerifierCiphertext: ciphertext, ReturnPath: returnPath,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		return LoginStart{}, err
	}
	challengeHash := sha256.Sum256([]byte(verifier))
	location := s.protocol.AuthorizationURL(provider, s.callbackURL(provider.Key), state, nonce, base64.RawURLEncoding.EncodeToString(challengeHash[:]))
	return LoginStart{
		Location: location, BrowserBinding: browserBinding, BindingCookieName: browserBindingCookieName(state),
		ExpiresAt: expiresAt,
	}, nil
}

// Callback consumes one state before exchanging the code and creating a local session.
func (s *LoginService) Callback(ctx context.Context, providerKey string, code string, state string, browserBinding string) (LoginCallback, error) {
	if !acquireLoginSlot(s.callbackSlots) {
		return LoginCallback{}, ErrLoginFailed
	}
	defer releaseLoginSlot(s.callbackSlots)
	ctx, cancel := context.WithTimeout(ctx, loginOperationTimeout)
	defer cancel()
	if state == "" {
		return LoginCallback{}, ErrLoginFailed
	}
	stateHash := sha256.Sum256([]byte(state))
	attempt, err := s.store.ConsumeOIDCLoginAttempt(ctx, stateHash[:])
	if err != nil {
		return LoginCallback{}, ErrLoginFailed
	}
	browserBindingHash := sha256.Sum256([]byte(browserBinding))
	if code == "" || browserBinding == "" || len(attempt.BrowserBindingHash) != sha256.Size || subtle.ConstantTimeCompare(attempt.BrowserBindingHash, browserBindingHash[:]) != 1 {
		return LoginCallback{}, ErrLoginFailed
	}
	provider, err := s.loadProvider(ctx, providerKey)
	if err != nil || !sameUUID(attempt.ProviderID, provider.ID) || !attempt.ExpiresAt.Valid || !attempt.ExpiresAt.Time.After(s.now()) {
		return LoginCallback{}, ErrLoginFailed
	}
	recordID := base64.RawURLEncoding.EncodeToString(stateHash[:])
	verifier, err := s.secrets.Open(loginVerifierPurpose, recordID, attempt.VerifierCiphertext)
	if err != nil {
		return LoginCallback{}, ErrLoginFailed
	}
	claims, err := s.protocol.ExchangeAndVerify(ctx, provider, s.callbackURL(provider.Key), code, string(verifier))
	if err != nil {
		return LoginCallback{}, ErrLoginFailed
	}
	nonceHash := sha256.Sum256([]byte(claims.Nonce))
	if len(attempt.NonceHash) != sha256.Size || subtle.ConstantTimeCompare(attempt.NonceHash, nonceHash[:]) != 1 {
		return LoginCallback{}, ErrLoginFailed
	}
	user, err := s.identities.ResolveOrCreate(ctx, provider, claims)
	if err != nil {
		return LoginCallback{}, err
	}
	session, err := s.sessions.Create(ctx, user.ID)
	if err != nil {
		return LoginCallback{}, err
	}
	return LoginCallback{Session: session, ReturnPath: attempt.ReturnPath}, nil
}

// browserBindingCookieName derives a collision-resistant cookie name for one state value.
func browserBindingCookieName(state string) string {
	digest := sha256.Sum256([]byte(state))
	return "moeurl_oidc_" + base64.RawURLEncoding.EncodeToString(digest[:12])
}

// loadProvider decrypts one enabled provider into a request-scoped runtime value.
func (s *LoginService) loadProvider(ctx context.Context, providerKey string) (RuntimeProvider, error) {
	row, err := s.store.GetEnabledOIDCProviderByKey(ctx, providerKey)
	if err != nil || !row.ID.Valid {
		return RuntimeProvider{}, ErrProviderNotFound
	}
	return runtimeProviderFromRow(row, s.secrets, true)
}

// ValidateEnabledProviderRuntime ensures every publicly advertised provider can be used with the active runtime key.
func ValidateEnabledProviderRuntime(rows []sqlc.OidcProvider, secrets *SecretBox, allowInsecureLoopback bool) error {
	for _, row := range rows {
		if _, err := runtimeProviderFromRow(row, secrets, allowInsecureLoopback); err != nil {
			return ErrRuntimeUnavailable
		}
	}
	return nil
}

// runtimeProviderFromRow validates and decrypts one persisted provider without exposing its secret on failure.
func runtimeProviderFromRow(row sqlc.OidcProvider, secrets *SecretBox, allowInsecureLoopback bool) (RuntimeProvider, error) {
	if !row.ID.Valid {
		return RuntimeProvider{}, ErrRuntimeUnavailable
	}
	var domains []string
	if err := json.Unmarshal(row.AllowedEmailDomains, &domains); err != nil {
		return RuntimeProvider{}, ErrRuntimeUnavailable
	}
	normalized, err := normalizeProviderInput(providerInput{
		Key: row.Key, DisplayName: row.DisplayName, IssuerURL: row.IssuerUrl,
		ClientID: row.ClientID, AllowedEmailDomains: domains,
	}, allowInsecureLoopback)
	if err != nil {
		return RuntimeProvider{}, ErrRuntimeUnavailable
	}
	if err := validateDiscoveryMetadata(row.IssuerUrl, DiscoveryMetadata{
		Issuer: row.IssuerUrl, AuthorizationEndpoint: row.AuthorizationEndpoint,
		TokenEndpoint: row.TokenEndpoint, JWKSURI: row.JwksUri,
	}, allowInsecureLoopback); err != nil {
		return RuntimeProvider{}, ErrRuntimeUnavailable
	}
	id := uuid.UUID(row.ID.Bytes).String()
	secret, err := secrets.Open(providerSecretPurpose, id, row.ClientSecretCiphertext)
	if err != nil {
		return RuntimeProvider{}, ErrSecretUnavailable
	}
	return RuntimeProvider{
		ID: row.ID, Key: normalized.Key, DisplayName: normalized.DisplayName, IssuerURL: normalized.IssuerURL,
		ClientID: normalized.ClientID, ClientSecret: string(secret), AuthorizationEndpoint: row.AuthorizationEndpoint,
		TokenEndpoint: row.TokenEndpoint, JWKSURI: row.JwksUri, AllowedEmailDomains: normalized.AllowedEmailDomains,
	}, nil
}

// randomToken produces an unpadded URL-safe token with fixed entropy.
func (s *LoginService) randomToken() (string, error) {
	value := make([]byte, loginRandomBytes)
	if _, err := io.ReadFull(s.random, value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

// callbackURL derives the registered callback from trusted normalized configuration.
func (s *LoginService) callbackURL(providerKey string) string {
	return s.publicBaseURL + "/api/v1/auth/oidc/" + providerKey + "/callback"
}

// isSafeReturnPath accepts only local absolute paths without control characters.
func isSafeReturnPath(value string) bool {
	if !strings.HasPrefix(value, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, `\`) {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

// sameUUID compares two valid provider identifiers without data-dependent timing.
func sameUUID(left pgtype.UUID, right pgtype.UUID) bool {
	return left.Valid && right.Valid && subtle.ConstantTimeCompare(left.Bytes[:], right.Bytes[:]) == 1
}

// acquireLoginSlot performs non-blocking admission to an OIDC operation class.
func acquireLoginSlot(slots chan struct{}) bool {
	select {
	case slots <- struct{}{}:
		return true
	default:
		return false
	}
}

// releaseLoginSlot returns one previously acquired operation slot.
func releaseLoginSlot(slots chan struct{}) {
	<-slots
}
