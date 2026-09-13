package oidc

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestDatabaseIdentityResolverCreatesAndReusesStandardUser verifies deterministic first-login provisioning.
func TestDatabaseIdentityResolverCreatesAndReusesStandardUser(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	resolver := NewDatabaseIdentityResolver(pool)
	claims := IdentityClaims{Subject: "stable-subject", Email: "person@Example.com", EmailVerified: true, Name: "  Person   Name  "}

	first, err := resolver.ResolveOrCreate(t.Context(), provider, claims)
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	second, err := resolver.ResolveOrCreate(t.Context(), provider, claims)
	if err != nil {
		t.Fatalf("reuse identity: %v", err)
	}
	if first.ID != second.ID || first.GroupKey != permission.GroupUser || first.Nickname != "Person Name" {
		t.Fatalf("resolved users: first=%#v second=%#v", first, second)
	}
	var users, identities int
	if err := pool.QueryRow(t.Context(), `select count(*) from app_user`).Scan(&users); err != nil {
		t.Fatalf("count users: %v", err)
	}
	if err := pool.QueryRow(t.Context(), `select count(*) from external_identity`).Scan(&identities); err != nil {
		t.Fatalf("count identities: %v", err)
	}
	if users != 1 || identities != 1 {
		t.Fatalf("row counts: users=%d identities=%d", users, identities)
	}
}

// TestDatabaseIdentityResolverRejectsUntrustedFirstLogin verifies rejected identities leave no local account.
func TestDatabaseIdentityResolverRejectsUntrustedFirstLogin(t *testing.T) {
	for _, claims := range []IdentityClaims{
		{Subject: "subject", Email: "person@example.com", EmailVerified: false},
		{Subject: "subject", Email: "person@other.example", EmailVerified: true},
		{Subject: "", Email: "person@example.com", EmailVerified: true},
	} {
		pool := testdb.ProjectMigratedPool(t.Context(), t)
		seedOIDCIdentityTestCatalog(t, pool)
		provider := identityTestProvider(t, pool)
		_, err := NewDatabaseIdentityResolver(pool).ResolveOrCreate(t.Context(), provider, claims)
		if !errors.Is(err, ErrIdentityNotAllowed) {
			t.Fatalf("claims %#v error = %v", claims, err)
		}
		var users int
		if err := pool.QueryRow(t.Context(), `select count(*) from app_user`).Scan(&users); err != nil || users != 0 {
			t.Fatalf("users after rejection = %d, err=%v", users, err)
		}
	}
}

// TestDatabaseIdentityResolverRejectsDisabledBoundUser verifies local status remains authoritative.
func TestDatabaseIdentityResolverRejectsDisabledBoundUser(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	resolver := NewDatabaseIdentityResolver(pool)
	claims := IdentityClaims{Subject: "subject", Email: "person@example.com", EmailVerified: true}
	user, err := resolver.ResolveOrCreate(t.Context(), provider, claims)
	if err != nil {
		t.Fatalf("create identity: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `update app_user set status = 'disabled' where id = $1`, user.ID); err != nil {
		t.Fatalf("disable user: %v", err)
	}
	if _, err := resolver.ResolveOrCreate(t.Context(), provider, claims); !errors.Is(err, ErrUserDisabled) {
		t.Fatalf("disabled login error = %v", err)
	}
}

// TestDatabaseIdentityResolverRejectsChangedNamespace prevents a stale login attempt from binding under new provider credentials.
func TestDatabaseIdentityResolverRejectsChangedNamespace(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	if _, err := pool.Exec(t.Context(), `update oidc_provider set client_id = 'different-client' where id = $1`, provider.ID); err != nil {
		t.Fatalf("change provider client: %v", err)
	}
	_, err := NewDatabaseIdentityResolver(pool).ResolveOrCreate(t.Context(), provider, IdentityClaims{
		Subject: "subject", Email: "person@example.com", EmailVerified: true,
	})
	if !errors.Is(err, ErrLoginFailed) {
		t.Fatalf("changed namespace error = %v, want ErrLoginFailed", err)
	}
	var identities int
	if err := pool.QueryRow(t.Context(), `select count(*) from external_identity`).Scan(&identities); err != nil || identities != 0 {
		t.Fatalf("identities after rejected login = %d, err=%v", identities, err)
	}
}

// TestIdentityBindingSerializesProviderNamespaceUpdate verifies binding holds the provider lock until commit.
func TestIdentityBindingSerializesProviderNamespaceUpdate(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	lock, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatalf("begin advisory lock: %v", err)
	}
	defer func() { _ = lock.Rollback(context.Background()) }()
	lockKey := uuid.UUID(provider.ID.Bytes).String() + ":subject"
	if _, err := lock.Exec(t.Context(), `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		t.Fatalf("hold subject lock: %v", err)
	}
	loginDone := make(chan error, 1)
	go func() {
		_, err := NewDatabaseIdentityResolver(pool).ResolveOrCreate(t.Context(), provider, IdentityClaims{
			Subject: "subject", Email: "person@example.com", EmailVerified: true,
		})
		loginDone <- err
	}()
	deadline, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var id pgtype.UUID
		err := pool.QueryRow(deadline, `select id from oidc_provider where id = $1 for update nowait`, provider.ID).Scan(&id)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "55P03" {
			break
		}
		if err != nil {
			t.Fatalf("inspect provider row lock: %v", err)
		}
		select {
		case <-deadline.Done():
			t.Fatal("identity binding did not lock provider row")
		case <-ticker.C:
		}
	}
	updateContext, stopUpdate := context.WithTimeout(t.Context(), 100*time.Millisecond)
	defer stopUpdate()
	if _, err := pool.Exec(updateContext, `update oidc_provider set client_id = 'different-client' where id = $1`, provider.ID); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("concurrent namespace update error = %v, want deadline", err)
	}
	if err := lock.Rollback(t.Context()); err != nil {
		t.Fatalf("release subject lock: %v", err)
	}
	if err := <-loginDone; err != nil {
		t.Fatalf("finish identity binding: %v", err)
	}
	var clientID string
	if err := pool.QueryRow(t.Context(), `select client_id from oidc_provider where id = $1`, provider.ID).Scan(&clientID); err != nil || clientID != "client" {
		t.Fatalf("provider namespace after binding = %q, err=%v", clientID, err)
	}
}

// TestProviderNamespaceUpdateRejectsExistingBinding verifies the transactional update preserves bound subjects.
func TestProviderNamespaceUpdateRejectsExistingBinding(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	if _, err := NewDatabaseIdentityResolver(pool).ResolveOrCreate(t.Context(), provider, IdentityClaims{
		Subject: "subject", Email: "person@example.com", EmailVerified: true,
	}); err != nil {
		t.Fatalf("bind identity: %v", err)
	}
	stored, err := sqlc.New(pool).GetOIDCProviderByID(t.Context(), provider.ID)
	if err != nil {
		t.Fatalf("read provider: %v", err)
	}
	store := &transactionalProviderStore{Queries: sqlc.New(pool), pool: pool}
	_, err = store.UpdateOIDCProvider(t.Context(), sqlc.UpdateOIDCProviderParams{
		DisplayName: stored.DisplayName, IssuerUrl: stored.IssuerUrl, ClientID: "different-client",
		ClientSecretCiphertext: stored.ClientSecretCiphertext, AuthorizationEndpoint: stored.AuthorizationEndpoint,
		TokenEndpoint: stored.TokenEndpoint, JwksUri: stored.JwksUri,
		AllowedEmailDomains: stored.AllowedEmailDomains, Enabled: stored.Enabled,
		ID: stored.ID, ExpectedUpdatedAt: stored.UpdatedAt,
	})
	if !errors.Is(err, ErrProviderConflict) {
		t.Fatalf("bound namespace update error = %v, want ErrProviderConflict", err)
	}
	current, err := sqlc.New(pool).GetOIDCProviderByID(t.Context(), provider.ID)
	if err != nil || current.ClientID != stored.ClientID {
		t.Fatalf("provider namespace changed: client=%q err=%v", current.ClientID, err)
	}
}

// TestFirstLoginAllowedRejectsMalformedAddresses verifies only exact verified mailbox domains are accepted.
func TestFirstLoginAllowedRejectsMalformedAddresses(t *testing.T) {
	if !firstLoginAllowed(IdentityClaims{Email: "person@EXAMPLE.com", EmailVerified: true}, []string{"example.com"}) {
		t.Fatal("valid normalized mailbox was rejected")
	}
	for _, email := range []string{"Person <person@example.com>", "person", "person@", "person@127.0.0.1"} {
		if firstLoginAllowed(IdentityClaims{Email: email, EmailVerified: true}, []string{"example.com"}) {
			t.Fatalf("malformed mailbox %q was accepted", email)
		}
	}
}

// TestExternalNicknameUsesSafeFallbacksAndRuneBounds verifies claim presentation never exceeds the user schema.
func TestExternalNicknameUsesSafeFallbacksAndRuneBounds(t *testing.T) {
	for _, test := range []struct {
		claims   IdentityClaims
		provider string
		want     string
	}{
		{claims: IdentityClaims{PreferredUsername: " preferred  name "}, provider: "Company", want: "preferred name"},
		{claims: IdentityClaims{Email: "local@example.com"}, provider: "Company", want: "local"},
		{claims: IdentityClaims{}, provider: "Company", want: "Company user"},
		{claims: IdentityClaims{}, provider: "", want: "user"},
		{claims: IdentityClaims{Name: strings.Repeat("界", 65)}, provider: "Company", want: strings.Repeat("界", 64)},
	} {
		if got := externalNickname(test.provider, test.claims); got != test.want {
			t.Fatalf("nickname = %q, want %q", got, test.want)
		}
	}
	if emailLocalPart("not-an-email") != "" || truncateRunes("short", 10) != "short" {
		t.Fatal("identity helper fallback changed")
	}
}

// TestCurrentUserFromIdentityRowRejectsInvalidPermissions verifies corrupt authorization JSON fails closed.
func TestCurrentUserFromIdentityRowRejectsInvalidPermissions(t *testing.T) {
	_, err := currentUserFromIdentityRow(sqlc.GetExternalIdentityUserRow{
		UserID: "user-id", Username: "user", Nickname: "User", GroupKey: "user",
		Permissions: []byte(`{}`),
	})
	if err == nil {
		t.Fatal("invalid permissions were accepted")
	}
	if _, err := NewDatabaseIdentityResolver(nil).ResolveOrCreate(t.Context(), RuntimeProvider{ID: pgtype.UUID{Valid: true}}, IdentityClaims{Subject: "subject"}); !errors.Is(err, ErrIdentityNotAllowed) {
		t.Fatalf("nil pool error = %v", err)
	}
}

// seedOIDCIdentityTestCatalog creates the built-in group required by provisioning tests.
func seedOIDCIdentityTestCatalog(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `insert into user_group (id, key, name, permissions, builtin, created_at, updated_at) values ($1, 'user', 'User', '["short_link:create"]', true, now(), now())`, uuid.New())
	if err != nil {
		t.Fatalf("seed user group: %v", err)
	}
}

// identityTestProvider persists and returns one enabled provider fixture.
func identityTestProvider(t *testing.T, pool *pgxpool.Pool) RuntimeProvider {
	t.Helper()
	id := uuid.New()
	_, err := pool.Exec(t.Context(), `insert into oidc_provider (id, key, display_name, issuer_url, client_id, client_secret_ciphertext, authorization_endpoint, token_endpoint, jwks_uri, allowed_email_domains, enabled, created_at, updated_at) values ($1, 'company', 'Company', 'https://id.example.com', 'client', '\x01', 'https://id.example.com/auth', 'https://id.example.com/token', 'https://id.example.com/jwks', '["example.com"]', true, now(), now())`, id)
	if err != nil {
		t.Fatalf("seed provider: %v", err)
	}
	return RuntimeProvider{ID: uuidToPGUUID(id), Key: "company", DisplayName: "Company", IssuerURL: "https://id.example.com", ClientID: "client", AllowedEmailDomains: []string{"example.com"}}
}
