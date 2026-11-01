package domain_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// Catches legacy writes using permissions checked before a queued request was
// disabled, deleted, moved, or revoked. Rejection must preserve every domain
// resource, its full revision, default mirror, preference, grant and audit row.
func TestDomainLegacyWritesReauthorizeAfterDomainLock(t *testing.T) {
	for _, action := range []string{"create", "update", "default", "delete"} {
		for _, mutation := range []struct{ name, sql string }{
			{"disabled", `update app_user set status='disabled' where id=$1`},
			{"deleted", `update app_user set deleted_at=now() where id=$1`},
			{"moved", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
			{"manage_revoked", `update user_group set permissions='["admin:access"]' where id=(select group_id from app_user where id=$1)`},
			{"access_revoked", `update user_group set permissions='["domain:manage"]' where id=(select group_id from app_user where id=$1)`},
			{"not_builtin", `update user_group set builtin=false where id=(select group_id from app_user where id=$1)`},
		} {
			t.Run(action+"/"+mutation.name, func(t *testing.T) {
				s, pool, admin, user, d := orderFixture(t)
				ctx := t.Context()
				_, err := pool.Exec(ctx, `insert into user_domain_preference(user_id,domain_id,updated_at) values($1,$2,now())`, user.ID, d.ID)
				require.NoError(t, err)
				state := func() string {
					var value string
					require.NoError(t, pool.QueryRow(ctx, `select jsonb_build_object(
						'domains',(select jsonb_agg(to_jsonb(d) order by id) from domain d),
						'grants',(select jsonb_agg(to_jsonb(g) order by domain_id,user_group_id) from domain_user_group g),
						'preferences',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),
						'settings',(select jsonb_agg(to_jsonb(s) order by key) from system_setting s),
						'audit',(select jsonb_agg(to_jsonb(a) order by id) from audit_log a))::text`).Scan(&value))
					return value
				}
				before := state()
				gate, err := pool.Begin(ctx)
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, gate.Rollback) }()
				_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
				require.NoError(t, err)
				result := make(chan error, 1)
				go func() {
					var writeErr error
					switch action {
					case "create":
						_, writeErr = s.Create(ctx, admin, domain.CreateInput{Host: "https://queued.example.com", DisplayName: "Queued", Enabled: true, AllowedGroups: []string{"admin"}})
					case "update":
						_, writeErr = s.Update(ctx, admin, domain.UpdateInput{ID: d.ID, Host: d.Host, DisplayName: "Queued", Enabled: false, AllowedGroups: []string{"admin"}, ExpectedUpdatedAt: d.UpdatedAt})
					case "default":
						_, writeErr = s.SetDefault(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
					case "delete":
						writeErr = s.Delete(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
					}
					result <- writeErr
				}()
				waitForDomainLockWaiters(t, pool, 1)
				_, err = pool.Exec(ctx, mutation.sql, admin.ID)
				require.NoError(t, err)
				require.NoError(t, gate.Commit(ctx))
				writeErr := <-result
				require.Equal(t, before, state(), "revoked write must preserve all persisted domain state")
				require.ErrorIs(t, writeErr, domain.ErrPermissionDenied)
			})
		}
	}
}

// An empty actor used to inherit admin permissions through its supplied group;
// it must not become an audited system operation that can create a domain.
func TestDomainLegacyCreateRejectsMissingActor(t *testing.T) {
	s, pool, _, _, _ := orderFixture(t)
	var before, after int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from domain`).Scan(&before))
	_, err := s.Create(t.Context(), auth.CurrentUser{GroupKey: permission.GroupAdmin}, domain.CreateInput{Host: "https://anonymous.example.com", DisplayName: "Anonymous", Enabled: true, AllowedGroups: []string{"admin"}})
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from domain`).Scan(&after))
	require.Equal(t, before, after)
}
