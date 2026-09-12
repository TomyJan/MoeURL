package oidc

import (
	"errors"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
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
	return RuntimeProvider{ID: uuidToPGUUID(id), Key: "company", DisplayName: "Company", AllowedEmailDomains: []string{"example.com"}}
}
