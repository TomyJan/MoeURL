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

// TestSuffixGateOrdering catches a missing shared gate or a policy read
// before waiting, while the opposite order proves saves wait for existing readers.
func TestSuffixGateOrdering(t *testing.T) {
	t.Run("existing reader before save", func(t *testing.T) {
		pool, _, actor := fixture(t)
		service := targetpolicy.NewSuffixService(pool)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
		result := make(chan error, 1)
		go func() {
			_, e := service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{"blocked.example"}, ExpectedUpdatedAt: current.UpdatedAt})
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
		_, err = tx.Exec(t.Context(), `update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist'`)
		require.NoError(t, err)
		deny := targetpolicy.NewService(pool)
		denyState, err := deny.Get(t.Context(), actor)
		require.NoError(t, err)
		allow := targetpolicy.NewAllowlistService(pool)
		allowState, err := allow.Get(t.Context(), actor)
		require.NoError(t, err)
		links := shortlink.NewService(pool, permission.NewDatabaseService(pool))
		result := make(chan error, 1)
		go func() {
			_, e := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://blocked.example/new"})
			result <- e
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		denyResult, allowResult := make(chan error, 1), make(chan error, 1)
		go func() {
			_, err := deny.Update(t.Context(), actor, targetpolicy.UpdateInput{Hosts: []string{"other.example"}, ExpectedUpdatedAt: denyState.UpdatedAt})
			denyResult <- err
		}()
		go func() {
			_, err := allow.Update(t.Context(), actor, targetpolicy.AllowlistUpdateInput{Enabled: false, Hosts: []string{}, ExpectedUpdatedAt: allowState.UpdatedAt})
			allowResult <- err
		}()
		require.Eventually(t, func() bool {
			var count int
			err := pool.QueryRow(t.Context(), `select count(*) from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid))`, tx.Conn().PgConn().PID()).Scan(&count)
			return err == nil && count == 3
		}, 3*time.Second, 5*time.Millisecond, "create and both other policy managers must share this gate")
		require.NoError(t, tx.Commit(t.Context()))
		require.ErrorIs(t, <-result, targetpolicy.ErrTargetDenied)
		require.NoError(t, <-denyResult)
		require.NoError(t, <-allowResult)
		var count int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
		require.Zero(t, count)
	})
}

// TestSuffixAdminTransactionsRevocation catches cached actor/group authority after a
// lock wait. It proves the save transaction takes identity locks after the gate.
func TestSuffixAdminTransactionsRevocation(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor := fixture(t)
			service := targetpolicy.NewSuffixService(pool)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() {
				_, e := service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{"blocked.example"}, ExpectedUpdatedAt: current.UpdatedAt})
				result <- e
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-result, targetpolicy.ErrPermissionDenied)
			_, err = service.Get(t.Context(), actor)
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_denylist'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}

// TestSuffixAdminTransactions catches last-writer-wins, stale no-op acceptance,
// partial audit failures, cancellation changes and replacement of future versions.
func TestSuffixAdminTransactions(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewSuffixService(pool)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	start := make(chan struct{})
	results := make(chan error, 2)
	for _, host := range []string{"one.example", "two.example"} {
		go func() {
			<-start
			_, e := service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{host}, ExpectedUpdatedAt: current.UpdatedAt})
			results <- e
		}()
	}
	close(start)
	a, b := <-results, <-results
	require.True(t, a == nil && errors.Is(b, targetpolicy.ErrConflict) || b == nil && errors.Is(a, targetpolicy.ErrConflict))
	saved, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_denylist'`).Scan(&count))
	require.Equal(t, 1, count, "concurrent replacements must have one successful audit")
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: saved.Suffixes, ExpectedUpdatedAt: current.UpdatedAt})
	require.ErrorIs(t, err, targetpolicy.ErrConflict)
	same, err := service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: saved.Suffixes, ExpectedUpdatedAt: saved.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, saved, same)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_host_suffix_denylist'`).Scan(&count))
	require.Equal(t, 1, count, "stale and genuine no-ops must not add audit")
	_, err = pool.Exec(t.Context(), `create function reject_policy_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$; create trigger reject_policy before insert on audit_log for each row execute function reject_policy_audit()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, e := pool.Exec(context.Background(), `drop trigger if exists reject_policy on audit_log;drop function if exists reject_policy_audit()`)
		require.NoError(t, e)
	})
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{"rollback.example"}, ExpectedUpdatedAt: saved.UpdatedAt})
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
		_, e := service.Update(ctx, actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{"cancel.example"}, ExpectedUpdatedAt: saved.UpdatedAt})
		out <- e
	}()
	waitBlocked(t, pool, tx.Conn().PgConn().PID())
	cancel()
	require.Error(t, <-out)
	require.NoError(t, tx.Rollback(t.Context()))
	after, err = service.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, saved, after)
	_, err = pool.Exec(t.Context(), `update system_setting set updated_at='2099-01-01T00:00:00Z' where key='security.target_host_suffix_denylist'`)
	require.NoError(t, err)
	future, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	next, err := service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{"future.example"}, ExpectedUpdatedAt: future.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, "2099-01-01T00:00:00.000001Z", next.UpdatedAt)
}

// TestSuffixStorageFailure catches missing/corrupt state being replaced by
// an allow-all default at startup or on the caller's transactional write check.
func TestSuffixStorageFailure(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewSuffixService(pool)
	require.NoError(t, service.ValidateStartup(t.Context()))
	for _, value := range []string{`null`, `{}`, `{"suffixes":null}`, `{"suffixes":["UPPER.example"]}`, `{"suffixes":["z.example","a.example"]}`, `{"suffixes":["a.example","a.example"]}`, `{"suffixes":[],"extra":true}`} {
		_, err := pool.Exec(t.Context(), `update system_setting set value=$1 where key='security.target_host_suffix_denylist'`, value)
		require.NoError(t, err)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), targetpolicy.ErrCorrupt)
		_, err = service.Get(t.Context(), actor)
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), targetpolicy.ErrCorrupt)
	}
	_, err := pool.Exec(t.Context(), `delete from system_setting where key='security.target_host_suffix_denylist'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), pgx.ErrNoRows)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, pgx.ErrNoRows)
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example"}), pgx.ErrNoRows)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-4000-8000-000000000001"} {
		bad := auth.CurrentUser{ID: id}
		_, err := service.Get(t.Context(), bad)
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
		_, err = service.Update(t.Context(), bad, targetpolicy.SuffixUpdateInput{})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
	}
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: nil, ExpectedUpdatedAt: "x"})
	require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	_, err = service.Update(t.Context(), actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "x"})
	require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.Get(canceled, actor)
	require.Error(t, err)
	_, err = service.Update(canceled, actor, targetpolicy.SuffixUpdateInput{Suffixes: []string{}, ExpectedUpdatedAt: "2026-11-11T00:00:00Z"})
	require.Error(t, err)
}
