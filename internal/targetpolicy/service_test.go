package targetpolicy_test

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }

func fixture(t *testing.T) (*pgxpool.Pool, *targetpolicy.Service, auth.CurrentUser) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	policy, err := system.NewSetupPolicy(false, "")
	require.NoError(t, err)
	require.NoError(t, system.NewService(pool, policy).Setup(t.Context(), system.SetupInput{AdminUsername: "admin", AdminPassword: "secure-password", AdminNickname: "Admin", SiteName: "MoeURL", SystemDomain: "example.com", ShortLinkDomain: "https://go.example.com", DefaultLanguage: "zh-CN", DefaultTheme: "system"}))
	var id string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&id))
	return pool, targetpolicy.NewService(pool), auth.CurrentUser{ID: id, GroupKey: "admin"}
}

func waitBlocked(t *testing.T, pool *pgxpool.Pool, pid uint32) {
	t.Helper()
	require.Eventually(t, func() bool {
		var blocked bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid)))`, pid).Scan(&blocked)
		return err == nil && blocked
	}, 3*time.Second, 5*time.Millisecond, "a real database waiter must be observed")
}

// TestTargetPolicyGateOrdering catches a missing shared gate or a policy read
// before waiting, while the opposite order proves saves wait for existing readers.
func TestTargetPolicyGateOrdering(t *testing.T) {
	t.Run("existing reader before save", func(t *testing.T) {
		pool, service, actor := fixture(t)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
		result := make(chan error, 1)
		go func() {
			_, e := service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"blocked.example"}, ExpectedUpdatedAt: current.UpdatedAt})
			result <- e
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		require.NoError(t, tx.Commit(t.Context()))
		require.NoError(t, <-result)
	})
	t.Run("save before new create", func(t *testing.T) {
		pool, _, actor := fixture(t)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
		_, err = tx.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
		require.NoError(t, err)
		links := shortlink.NewService(pool, permission.NewDatabaseService(pool))
		result := make(chan error, 1)
		go func() {
			_, e := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://blocked.example/new"})
			result <- e
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		require.NoError(t, tx.Commit(t.Context()))
		require.ErrorIs(t, <-result, targetpolicy.ErrTargetDenied)
		var count int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
		require.Zero(t, count)
	})
}

// TestTargetPolicyQueuedRevocation catches cached actor/group authority after a
// lock wait. It proves the save transaction takes identity locks after the gate.
func TestTargetPolicyQueuedRevocation(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, actor := fixture(t)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() {
				_, e := service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"blocked.example"}, ExpectedUpdatedAt: current.UpdatedAt})
				result <- e
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-result, targetpolicy.ErrPermissionDenied)
			_, err = service.Get(t.Context(), actor)
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_denylist'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}

// TestTargetPolicyCASAndRollback catches last-writer-wins, stale no-op acceptance,
// partial audit failures, cancellation changes and replacement of future versions.
func TestTargetPolicyCASAndRollback(t *testing.T) {
	pool, service, actor := fixture(t)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, host := range []string{"one.example", "two.example"} {
		go func() {
			<-start
			_, e := service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{host}, ExpectedUpdatedAt: current.UpdatedAt})
			results <- e
		}()
	}
	close(start)
	a, b := <-results, <-results
	require.True(t, a == nil && errors.Is(b, targetpolicy.ErrConflict) || b == nil && errors.Is(a, targetpolicy.ErrConflict))
	saved, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: saved.Hosts, ExpectedUpdatedAt: current.UpdatedAt})
	require.ErrorIs(t, err, targetpolicy.ErrConflict)
	same, err := service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: saved.Hosts, ExpectedUpdatedAt: saved.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, saved, same)
	_, err = pool.Exec(t.Context(), `create function reject_policy_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$; create trigger reject_policy before insert on audit_log for each row execute function reject_policy_audit()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, e := pool.Exec(context.Background(), `drop trigger if exists reject_policy on audit_log;drop function if exists reject_policy_audit()`)
		require.NoError(t, e)
	})
	_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"rollback.example"}, ExpectedUpdatedAt: saved.UpdatedAt})
	require.Error(t, err)
	after, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, saved, after)
	_, err = pool.Exec(t.Context(), `drop trigger reject_policy on audit_log;drop function reject_policy_audit()`)
	require.NoError(t, err)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer testdb.Rollback(t, tx.Rollback)
	require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
	ctx, cancel := context.WithCancel(t.Context())
	out := make(chan error, 1)
	go func() {
		_, e := service.Update(ctx, actor, targetpolicy.UpdateInput{Hosts: []string{"cancel.example"}, ExpectedUpdatedAt: saved.UpdatedAt})
		out <- e
	}()
	waitBlocked(t, pool, tx.Conn().PgConn().PID())
	cancel()
	require.Error(t, <-out)
	require.NoError(t, tx.Rollback(t.Context()))
	after, err = service.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, saved, after)
	_, err = pool.Exec(t.Context(), `update system_setting set updated_at='2099-01-01T00:00:00Z' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	future, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	next, err := service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"future.example"}, ExpectedUpdatedAt: future.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, "2099-01-01T00:00:00.000001Z", next.UpdatedAt)
}

// TestTargetPolicyStorageFailure catches missing/corrupt state being replaced by
// an allow-all default at startup or on the caller's transactional write check.
func TestTargetPolicyStorageFailure(t *testing.T) {
	pool, service, actor := fixture(t)
	require.NoError(t, service.ValidateStartup(t.Context()))
	for _, value := range []string{`null`, `{}`, `{"hosts":null}`, `{"hosts":["UPPER.example"]}`, `{"hosts":["z.example","a.example"]}`, `{"hosts":["a.example","a.example"]}`, `{"hosts":[],"extra":true}`} {
		_, err := pool.Exec(t.Context(), `update system_setting set value=$1 where key='security.target_host_denylist'`, value)
		require.NoError(t, err)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), targetpolicy.ErrCorrupt)
		_, err = service.Get(t.Context(), actor)
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), targetpolicy.ErrCorrupt)
	}
	_, err := pool.Exec(t.Context(), `delete from system_setting where key='security.target_host_denylist'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), pgx.ErrNoRows)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, pgx.ErrNoRows)
	_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), pgx.ErrNoRows)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-4000-8000-000000000001"} {
		bad := auth.CurrentUser{ID: id}
		_, err := service.Get(t.Context(), bad)
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
		_, err = service.Update(t.Context(), bad, targetpolicy.UpdateInput{})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
	}
	_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: nil, ExpectedUpdatedAt: "x"})
	require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	_, err = service.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{}, ExpectedUpdatedAt: "x"})
	require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.Get(canceled, actor)
	require.Error(t, err)
	_, err = service.Update(canceled, actor, targetpolicy.UpdateInput{Hosts: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
	require.Error(t, err)
}
