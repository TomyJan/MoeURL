package shortlink_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// Captured administrator grants cannot bypass current database revocation even
// when every target would otherwise produce invalid_target without reading rules.
func TestTargetPolicyBatchCheckAuthorization(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"ordinary", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"builtin actor", `update app_user set builtin=true where id=$1`},
		{"nonbuiltin group", `update user_group set builtin=false where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"missing system grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"missing admin grant", `update user_group set permissions='["system:manage"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, actor := targetWriteFixture(t)
			_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000000402','user','User','[]',true,now(),now())`)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			result, err := service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://localhost/", "ftp://example.com/"}})
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			require.Nil(t, result.Items)
		})
	}
	pool, service, actor := targetWriteFixture(t)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "{" + actor.ID + "}", "00000000-0000-4000-8000-000000007399"} {
		result, err := service.BatchCheckTargetPolicy(t.Context(), auth.CurrentUser{ID: id}, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://example.com/"}})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
		require.Nil(t, result.Items)
	}
	_, err := pool.Exec(t.Context(), `update user_group set permissions='null' where key='admin'`)
	require.NoError(t, err)
	result, err := service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://example.com/"}})
	// Corrupt authority is infrastructure failure, never a per-target result.
	require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
	require.Nil(t, result.Items)
}

// Each result must use the same seven-rule matcher, in original order including
// duplicates, while a corrupt resource aborts the batch before any partial result.
func TestTargetPolicyBatchCheckSavedRules(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	_, err := pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["allowed.example"]}' where key='security.target_host_allowlist';
	update system_setting set value='{"enabled":true,"suffixes":["family.example"]}' where key='security.target_host_suffix_allowlist';
	update system_setting set value='{"enabled":true,"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_allowlist';
	update system_setting set value='{"hosts":["blocked.family.example"]}' where key='security.target_host_denylist';
	update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist';
	update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist';
	update system_setting set value='{"prefixes":["203.0.113.128/25"]}' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	input := shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{
		"https://allowed.example/", "https://localhost/", "https://sub.family.example/", "https://203.0.113.1/", "https://[::ffff:203.0.113.1]/",
		"https://other.example/", "https://198.51.100.1/", "https://blocked.family.example/", "https://deep.blocked.example/",
		"https://203.0.113.9/", "https://[::ffff:203.0.113.9]/", "https://203.0.113.129/", "https://127.0.0.1/", "https://010.1.2.3/", "https://allowed.example/",
	}}
	result, err := service.BatchCheckTargetPolicy(t.Context(), actor, input)
	require.NoError(t, err)
	wants := []string{"allowed", "invalid_target", "allowed", "allowed", "allowed", "restricted", "restricted", "restricted", "restricted", "restricted", "restricted", "restricted", "invalid_target", "invalid_target", "allowed"}
	require.Len(t, result.Items, len(wants))
	for i, want := range wants {
		require.Equal(t, shortlink.TargetPolicyBatchCheckItem{Index: i + 1, Outcome: want}, result.Items[i])
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
				var got []byte
				require.NoError(t, pool.QueryRow(ctx, `select value from system_setting where key=$1`, key).Scan(&got))
				require.JSONEq(t, string(original), string(got))
			})
			_, err := pool.Exec(t.Context(), `update system_setting set value='{}' where key=$1`, key)
			require.NoError(t, err)
			got, err := service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://localhost/", "https://blocked.family.example/", "https://allowed.example/"}})
			require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
			require.Nil(t, got.Items)
			// All-basic-invalid batches intentionally do not read policy resources.
			got, err = service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://localhost/", "ftp://example.com/"}})
			require.NoError(t, err)
			require.Equal(t, []shortlink.TargetPolicyBatchCheckItem{{Index: 1, Outcome: "invalid_target"}, {Index: 2, Outcome: "invalid_target"}}, got.Items)
		})
	}
}

// The gate must be acquired before a statement snapshot; cancellation discards
// every item rather than yielding an old saved rule or a partially filled set.
func TestTargetPolicyBatchCheckWaitsForSavedPolicy(t *testing.T) {
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
				result shortlink.TargetPolicyBatchCheckResult
				err    error
			}
			out := make(chan answer, 1)
			go func() {
				got, err := service.BatchCheckTargetPolicy(ctx, actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://blocked.example/", "https://example.com/", "https://blocked.example/"}})
				out <- answer{got, err}
			}()
			waitTargetWriteBlocked(t, pool, tx.Conn().PgConn().PID())
			if cancelWait {
				cancel()
			}
			require.NoError(t, tx.Commit(t.Context()))
			got := <-out
			if cancelWait {
				require.Error(t, got.err)
				require.Nil(t, got.result.Items)
			} else {
				require.NoError(t, got.err)
				require.Equal(t, []shortlink.TargetPolicyBatchCheckItem{{Index: 1, Outcome: "restricted"}, {Index: 2, Outcome: "allowed"}, {Index: 3, Outcome: "restricted"}}, got.result.Items)
			}
		})
	}
}

// Service calls do not run session middleware, so their complete database
// snapshot must remain equal across allowed, basic-invalid and malformed inputs.
func TestTargetPolicyBatchCheckDoesNotWrite(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	before := policyCheckDatabaseSnapshot(t, pool)
	_, err := service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://example.com/private?secret=fixture", "https://localhost/"}})
	require.NoError(t, err)
	for _, targets := range [][]string{nil, {}, {""}, {strings.Repeat("a", 2049)}, {"https://example.com/\n"}, {"https://example.com/\xff"}, make([]string, 21)} {
		got, err := service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: targets})
		require.ErrorIs(t, err, shortlink.ErrTargetPolicyBatchCheckInvalidInput)
		require.Nil(t, got.Items)
	}
	require.Equal(t, before, policyCheckDatabaseSnapshot(t, pool))
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	got, err := service.BatchCheckTargetPolicy(ctx, actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://example.com/"}})
	require.Error(t, err)
	require.Nil(t, got.Items)
	pool.Close()
	got, err = service.BatchCheckTargetPolicy(t.Context(), actor, shortlink.TargetPolicyBatchCheckInput{TargetURLs: []string{"https://example.com/"}})
	require.Error(t, err)
	require.Nil(t, got.Items)
}
