package shortlink_test

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// Rejecting basic URLs before authorization would disclose a decision to an
// identity whose captured administrator snapshot has already become invalid.
func TestTargetPolicyCheckAuthorization(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"ordinary user", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"builtin actor", `update app_user set builtin=true where id=$1`},
		{"nonbuiltin group", `update user_group set builtin=false where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"missing system grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"missing admin grant", `update user_group set permissions='["system:manage"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, actor := targetWriteFixture(t)
			_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
				('00000000-0000-0000-0000-000000000402','user','User','[]',true,now(),now())`)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			result, err := service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: "https://localhost/"})
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			require.Empty(t, result.Outcome)
		})
	}
	pool, service, actor := targetWriteFixture(t)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "{" + actor.ID + "}", "00000000-0000-4000-8000-000000007299"} {
		_, err := service.CheckTargetPolicy(t.Context(), auth.CurrentUser{ID: id}, shortlink.TargetPolicyCheckInput{TargetURL: "https://example.com/"})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
	}
	_, err := pool.Exec(t.Context(), `update user_group set permissions='null' where key='admin'`)
	require.NoError(t, err)
	_, err = service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: "https://example.com/"})
	require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
}

// All denials precede the three-way allow union; the check must share the real
// write policy rather than implementing a second, more permissive matcher.
func TestTargetPolicyCheckSavedRules(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	_, err := pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["allowed.example"]}' where key='security.target_host_allowlist';
		update system_setting set value='{"enabled":true,"suffixes":["family.example"]}' where key='security.target_host_suffix_allowlist';
		update system_setting set value='{"enabled":true,"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_allowlist';
		update system_setting set value='{"hosts":["blocked.family.example"]}' where key='security.target_host_denylist';
		update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist';
		update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist';
		update system_setting set value='{"prefixes":["203.0.113.128/25"]}' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	for _, tc := range []struct{ target, outcome string }{
		{"https://allowed.example/", "allowed"}, {"https://sub.family.example/", "allowed"},
		{"https://203.0.113.1/", "allowed"}, {"https://[::ffff:203.0.113.1]/", "allowed"},
		{"https://other.example/", "restricted"}, {"https://198.51.100.1/", "restricted"},
		{"https://blocked.family.example/", "restricted"}, {"https://deep.blocked.example/", "restricted"},
		{"https://203.0.113.9/", "restricted"}, {"https://[::ffff:203.0.113.9]/", "restricted"},
		{"https://203.0.113.129/", "restricted"}, {"https://127.0.0.1/", "invalid_target"},
		{"https://010.1.2.3/", "invalid_target"},
	} {
		t.Run(tc.target, func(t *testing.T) {
			result, err := service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: tc.target})
			require.NoError(t, err)
			require.Equal(t, tc.outcome, result.Outcome)
		})
	}
	for _, key := range []string{targetpolicy.Key, targetpolicy.AllowlistKey, targetpolicy.SuffixKey, targetpolicy.SuffixAllowlistKey, targetpolicy.IPKey, targetpolicy.CIDRKey, targetpolicy.CIDRAllowlistKey} {
		t.Run("corrupt "+key, func(t *testing.T) {
			var original []byte
			require.NoError(t, pool.QueryRow(t.Context(), `select value from system_setting where key=$1`, key).Scan(&original))
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, err := pool.Exec(ctx, `update system_setting set value=$1 where key=$2`, original, key)
				require.NoError(t, err)
				var restored []byte
				require.NoError(t, pool.QueryRow(ctx, `select value from system_setting where key=$1`, key).Scan(&restored))
				require.JSONEq(t, string(original), string(restored))
			})
			_, err := pool.Exec(t.Context(), `update system_setting set value='{}' where key=$1`, key)
			require.NoError(t, err)
			// Even a known deny must not conceal a later corrupt resource.
			result, err := service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: "https://blocked.family.example/"})
			require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
			require.Empty(t, result.Outcome)
		})
	}
}

// A repeatable snapshot acquired while waiting on the advisory gate would
// incorrectly let the target through using policy from before the save.
func TestTargetPolicyCheckWaitsForSavedPolicy(t *testing.T) {
	for _, cancelWait := range []bool{false, true} {
		t.Run(fmt.Sprintf("cancel=%t", cancelWait), func(t *testing.T) {
			pool, service, actor := targetWriteFixture(t)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
			_, err = tx.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
			require.NoError(t, err)
			ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
			defer cancel()
			type answer struct {
				result shortlink.TargetPolicyCheckResult
				err    error
			}
			out := make(chan answer, 1)
			go func() {
				result, err := service.CheckTargetPolicy(ctx, actor, shortlink.TargetPolicyCheckInput{TargetURL: "https://blocked.example/"})
				out <- answer{result, err}
			}()
			waitTargetWriteBlocked(t, pool, tx.Conn().PgConn().PID())
			if cancelWait {
				cancel()
			}
			require.NoError(t, tx.Commit(t.Context()))
			got := <-out
			if cancelWait {
				require.Error(t, got.err)
				require.Empty(t, got.result.Outcome)
			} else {
				require.NoError(t, got.err)
				require.Equal(t, "restricted", got.result.Outcome)
			}
		})
	}
}

// Read-only checks must not leave links, events, receipts, quota reservations,
// audits, revisions or any other application table changed.
func TestTargetPolicyCheckDoesNotWrite(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	before := policyCheckDatabaseSnapshot(t, pool)
	for _, target := range []string{"https://example.com/private?secret=test", "https://localhost/"} {
		_, err := service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: target})
		require.NoError(t, err)
	}
	require.Equal(t, before, policyCheckDatabaseSnapshot(t, pool))
	for _, input := range []string{"", strings.Repeat("a", 2049), "https://example.com/\n", "https://example.com/\xff"} {
		_, err := service.CheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyCheckInput{TargetURL: input})
		require.ErrorIs(t, err, shortlink.ErrTargetPolicyCheckInvalidInput)
	}
	require.Equal(t, before, policyCheckDatabaseSnapshot(t, pool))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := service.CheckTargetPolicy(ctx, actor, shortlink.TargetPolicyCheckInput{TargetURL: "https://example.com/"})
	require.Error(t, err)
	require.Empty(t, result.Outcome)
}

func policyCheckDatabaseSnapshot(t *testing.T, pool *pgxpool.Pool) map[string]string {
	t.Helper()
	rows, err := pool.Query(t.Context(), `select tablename from pg_tables where schemaname='public' order by tablename`)
	require.NoError(t, err)
	names, err := pgx.CollectRows(rows, pgx.RowTo[string])
	require.NoError(t, err)
	result := make(map[string]string, len(names))
	for _, name := range names {
		var value json.RawMessage
		require.NoError(t, pool.QueryRow(t.Context(), `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from `+pgx.Identifier{name}.Sanitize()+` t`).Scan(&value))
		result[name] = string(value)
	}
	return result
}
