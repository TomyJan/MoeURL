package oidc

import (
	"encoding/json"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestProviderAuditMutations verifies production store wiring and atomic rollback for all provider actions.
func TestProviderAuditMutations(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	ctx := t.Context()
	actor := adminActor()
	service := NewProviderService(pool, permission.NewService(), &discovererStub{metadata: testDiscoveryMetadata()}, testSecretBox(t), "https://links.example.com", false)
	input := CreateProviderInput{Key: "audit", DisplayName: "Audit", IssuerURL: "https://id.example.com", ClientID: "private-client", ClientSecret: "secret-not-in-audit", AllowedEmailDomains: []string{"example.com"}, Enabled: true}
	created, err := service.Create(ctx, actor, input)
	require.NoError(t, err)
	assertLast := func(action string, fields []string) {
		t.Helper()
		var actualActor, id, actualAction string
		var actualFields []string
		require.NoError(t, pool.QueryRow(ctx, `select actor_id::text,resource_id,action,changed_fields from audit_log where resource_type='oidc_provider' order by id desc limit 1`).Scan(&actualActor, &id, &actualAction, &actualFields))
		require.Equal(t, actor.ID, actualActor)
		require.Equal(t, created.Provider.ID, id)
		require.Equal(t, action, actualAction)
		require.ElementsMatch(t, fields, actualFields)
	}
	expectedCreateFields := []string{"key", "display_name", "issuer_url", "client_id", "client_secret_ciphertext", "authorization_endpoint", "token_endpoint", "jwks_uri", "allowed_email_domains", "enabled", "deleted_at"}
	assertLast("create", expectedCreateFields)
	update := UpdateProviderInput{ID: created.Provider.ID, ExpectedUpdatedAt: created.Provider.UpdatedAt, DisplayName: input.DisplayName, IssuerURL: input.IssuerURL, ClientID: input.ClientID, ClientSecret: SecretChange{Mode: SecretPreserve}, AllowedEmailDomains: input.AllowedEmailDomains, Enabled: false}
	updated, err := service.Update(ctx, actor, update)
	require.NoError(t, err)
	assertLast("disable", []string{"enabled"})
	update.ExpectedUpdatedAt = updated.Provider.UpdatedAt
	update.Enabled = true
	updated, err = service.Update(ctx, actor, update)
	require.NoError(t, err)
	assertLast("enable", []string{"enabled"})
	_, err = pool.Exec(ctx, `create function fail_audit_write() returns trigger language plpgsql as $$ begin raise exception 'private diagnostic' using errcode='23505',constraint='audit_injected'; end $$; create trigger fail_audit_write before insert on audit_log for each row execute function fail_audit_write()`)
	require.NoError(t, err)
	var before string
	require.NoError(t, pool.QueryRow(ctx, `select row_to_json(oidc_provider)::text from oidc_provider where key='audit'`).Scan(&before))
	input.Key = "other"
	_, err = service.Create(ctx, actor, input)
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrProviderKeyExists)
	update.ExpectedUpdatedAt = updated.Provider.UpdatedAt
	update.DisplayName = "Change"
	_, err = service.Update(ctx, actor, update)
	require.Error(t, err)
	_, err = service.Delete(ctx, actor, DeleteProviderInput{ID: created.Provider.ID, ExpectedUpdatedAt: updated.Provider.UpdatedAt})
	require.Error(t, err)
	var after string
	require.NoError(t, pool.QueryRow(ctx, `select row_to_json(oidc_provider)::text from oidc_provider where key='audit'`).Scan(&after))
	require.Equal(t, before, after)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from oidc_provider`).Scan(&count))
	require.Equal(t, 1, count)
	_, err = pool.Exec(ctx, `drop trigger fail_audit_write on audit_log`)
	require.NoError(t, err)
	_, err = service.Delete(ctx, actor, DeleteProviderInput{ID: created.Provider.ID, ExpectedUpdatedAt: updated.Provider.UpdatedAt})
	require.NoError(t, err)
	assertLast("delete", []string{"enabled", "deleted_at"})
	var logs []byte
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_agg(audit_log) from audit_log`).Scan(&logs))
	require.True(t, json.Valid(logs))
	require.NotContains(t, string(logs), "secret-not-in-audit")
	require.NotContains(t, string(logs), "private-client")
}

// TestProvisionAuditAtomicity proves automatic identity creation has a system actor and leaves no partial binding on audit failure.
func TestProvisionAuditAtomicity(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	seedOIDCIdentityTestCatalog(t, pool)
	provider := identityTestProvider(t, pool)
	ctx := t.Context()
	resolver := NewDatabaseIdentityResolver(pool)
	_, err := pool.Exec(ctx, `alter table audit_log add constraint audit_failure check(false) not valid`)
	require.NoError(t, err)
	claims := IdentityClaims{Subject: "private-subject", Email: "private@example.com", EmailVerified: true}
	_, err = resolver.ResolveOrCreate(ctx, provider, claims)
	require.Error(t, err)
	var count int
	for _, table := range []string{"app_user", "external_identity", "audit_log"} {
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from `+table).Scan(&count))
		require.Zero(t, count)
	}
	_, err = pool.Exec(ctx, `alter table audit_log drop constraint audit_failure`)
	require.NoError(t, err)
	created, err := resolver.ResolveOrCreate(ctx, provider, claims)
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id is null and resource_type='user' and resource_id=$1 and action='create'`, created.ID).Scan(&count))
	require.Equal(t, 1, count)
}
