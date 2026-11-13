package targetpolicy_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestSuffixAllowlistGateOrdering catches either manager using a different
// gate, and writers reading a stale policy before the manager commits.
func TestSuffixAllowlistGateOrdering(t *testing.T) {
	for _, blocker := range []string{"target reader", "denylist save"} {
		t.Run(blocker+" before allowlist save", func(t *testing.T) {
			pool, _, actor := fixture(t)
			service := targetpolicy.NewSuffixAllowlistService(pool)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			if blocker == "target reader" {
				require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
			} else {
				require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
				_, err = tx.Exec(t.Context(), `update system_setting set value='{"hosts":["denied.example"]}' where key='security.target_host_denylist'`)
				require.NoError(t, err)
			}
			out := make(chan error, 1)
			go func() {
				_, err := service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Enabled: true, Suffixes: []string{"allowed.example"}, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.NoError(t, <-out)
		})
	}
	t.Run("allowlist save before create and denylist save", func(t *testing.T) {
		pool, deny, actor := fixture(t)
		current, err := deny.Get(t.Context(), actor)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
		_, err = tx.Exec(t.Context(), `update system_setting set value='{"enabled":true,"suffixes":["allowed.example"]}' where key='security.target_host_suffix_allowlist'`)
		require.NoError(t, err)
		links := shortlink.NewService(pool, permission.NewDatabaseService(pool))
		out := make(chan error, 1)
		go func() {
			_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://other.example/new"})
			out <- err
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		denyOut := make(chan error, 1)
		go func() {
			_, err := deny.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"denied.example"}, ExpectedUpdatedAt: current.UpdatedAt})
			denyOut <- err
		}()
		// The first waiter is already observed; verify this distinct save is queued.
		require.Eventually(t, func() bool {
			var n int
			err := pool.QueryRow(t.Context(), `select count(*) from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid))`, tx.Conn().PgConn().PID()).Scan(&n)
			return err == nil && n == 2
		}, 3*time.Second, 5*time.Millisecond)
		require.NoError(t, tx.Commit(t.Context()))
		require.ErrorIs(t, <-out, targetpolicy.ErrTargetDenied)
		require.NoError(t, <-denyOut)
	})
}

// TestTargetHostSuffixAllowlistAdminTransactions catches stale authority after waits,
// lost CAS, partial audit failure, cancellation writes and nonmonotonic versions.
func TestTargetHostSuffixAllowlistAdminTransactions(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor := fixture(t)
			service := targetpolicy.NewSuffixAllowlistService(pool)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			out := make(chan error, 1)
			go func() {
				_, err := service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Enabled: true, Suffixes: []string{"allowed.example"}, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-out, targetpolicy.ErrPermissionDenied)
			_, err = service.Get(t.Context(), actor)
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_allowlist'`).Scan(&count))
			require.Zero(t, count)
		})
	}
	t.Run("CAS rollback cancel future", func(t *testing.T) {
		pool, _, actor := fixture(t)
		service := targetpolicy.NewSuffixAllowlistService(pool)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		start, out := make(chan struct{}), make(chan error, 2)
		for _, host := range []string{"one.example", "two.example"} {
			go func() {
				<-start
				_, err := service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Enabled: true, Suffixes: []string{host}, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
		}
		close(start)
		a, b := <-out, <-out
		require.True(t, a == nil && errors.Is(b, targetpolicy.ErrConflict) || b == nil && errors.Is(a, targetpolicy.ErrConflict))
		saved, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		var count int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_allowlist'`).Scan(&count))
		require.Equal(t, 1, count)
		same, err := service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Enabled: true, Suffixes: saved.Suffixes, ExpectedUpdatedAt: saved.UpdatedAt})
		require.NoError(t, err)
		require.Equal(t, saved, same)
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_allowlist'`).Scan(&count))
		require.Equal(t, 1, count, "a genuine no-op must retain the exact revision and audit count")
		_, err = service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Enabled: true, Suffixes: saved.Suffixes, ExpectedUpdatedAt: current.UpdatedAt})
		require.ErrorIs(t, err, targetpolicy.ErrConflict)
		_, err = pool.Exec(t.Context(), `create function reject_allowlist_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$;create trigger reject_allowlist before insert on audit_log for each row execute function reject_allowlist_audit()`)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, e := pool.Exec(context.Background(), `drop trigger if exists reject_allowlist on audit_log;drop function if exists reject_allowlist_audit()`)
			require.NoError(t, e)
		})
		_, err = service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: saved.UpdatedAt})
		require.Error(t, err)
		after, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		require.Equal(t, saved, after)
		_, err = pool.Exec(t.Context(), `drop trigger reject_allowlist on audit_log;drop function reject_allowlist_audit()`)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go func() {
			_, e := service.Update(ctx, actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: saved.UpdatedAt})
			out <- e
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		cancel()
		require.Error(t, <-out)
		require.NoError(t, tx.Rollback(t.Context()))
		after, err = service.Get(t.Context(), actor)
		require.NoError(t, err)
		require.Equal(t, saved, after)
		_, err = pool.Exec(t.Context(), `update system_setting set updated_at='2099-01-01T00:00:00Z' where key='security.target_host_suffix_allowlist'`)
		require.NoError(t, err)
		future, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		next, err := service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: future.UpdatedAt})
		require.NoError(t, err)
		require.Equal(t, "2099-01-01T00:00:00.000001Z", next.UpdatedAt)
	})
}

// TestSuffixAllowlistStorageFailure catches silently defaulting absent/corrupt policy,
// including disabled policy, and trusting invalid/cached actor identities.
func TestSuffixAllowlistStorageFailure(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewSuffixAllowlistService(pool)
	require.NoError(t, service.ValidateStartup(t.Context()))
	for _, value := range []string{`null`, `{}`, `{"enabled":null,"suffixes":[]}`, `{"enabled":true,"suffixes":[]}`, `{"enabled":false,"suffixes":["UPPER.example"]}`, `{"enabled":false,"suffixes":[],"extra":1}`} {
		_, err := pool.Exec(t.Context(), `update system_setting set value=$1 where key='security.target_host_suffix_allowlist'`, value)
		require.NoError(t, err)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), targetpolicy.ErrCorrupt)
		_, err = service.Get(t.Context(), actor)
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		_, err = service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-12T00:00:00Z"})
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), targetpolicy.ErrCorrupt)
	}
	_, err := pool.Exec(t.Context(), `delete from system_setting where key='security.target_host_suffix_allowlist'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), pgx.ErrNoRows)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, pgx.ErrNoRows)
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-12T00:00:00Z"})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), pgx.ErrNoRows)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-4000-8000-000000000001"} {
		_, err := service.Get(t.Context(), auth.CurrentUser{ID: id})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
		_, err = service.Update(t.Context(), auth.CurrentUser{ID: id}, targetpolicy.SuffixAllowlistUpdateInput{})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
	}
	for _, input := range []targetpolicy.SuffixAllowlistUpdateInput{{}, {Enabled: true, Suffixes: []string{}}, {Suffixes: []string{}, ExpectedUpdatedAt: "x"}} {
		_, err := service.Update(t.Context(), actor, input)
		require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.Get(canceled, actor)
	require.Error(t, err)
	_, err = service.Update(canceled, actor, targetpolicy.SuffixAllowlistUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-12T00:00:00Z"})
	require.Error(t, err)
}
