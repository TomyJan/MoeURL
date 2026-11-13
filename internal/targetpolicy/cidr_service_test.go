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

// TestCIDRGateOrdering catches a separate gate, identity locks acquired before it,
// and new target writes reading policy before the pending save commits.
func TestCIDRGateOrdering(t *testing.T) {
	for _, exclusive := range []bool{false, true} {
		t.Run(map[bool]string{false: "existing reader", true: "other policy save"}[exclusive], func(t *testing.T) {
			pool, _, actor := fixture(t)
			service := targetpolicy.NewCIDRService(pool)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			if exclusive {
				require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
			} else {
				require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
			}
			out := make(chan error, 1)
			go func() {
				_, err := service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{"203.0.113.0/24"}, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			_, err = tx.Exec(t.Context(), `set local lock_timeout='1s'`)
			require.NoError(t, err)
			_, err = tx.Exec(t.Context(), `update app_user set nickname=nickname where id=$1`, actor.ID)
			require.NoError(t, err, "manager waiting on gate must not already hold actor lock")
			require.NoError(t, tx.Commit(t.Context()))
			require.NoError(t, <-out)
		})
	}
	t.Run("save before new target", func(t *testing.T) {
		pool, _, actor := fixture(t)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
		_, err = tx.Exec(t.Context(), `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`)
		require.NoError(t, err)
		links := shortlink.NewService(pool, permission.NewDatabaseService(pool))
		out := make(chan error, 1)
		go func() {
			_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://203.0.113.9/new"})
			out <- err
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		require.NoError(t, tx.Commit(t.Context()))
		require.ErrorIs(t, <-out, targetpolicy.ErrTargetDenied)
		var count int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
		require.Zero(t, count)
	})
}

// TestCIDRQueuedRevocation catches trusting cached identity after real row waits.
func TestCIDRQueuedRevocation(t *testing.T) {
	for _, tc := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"grant", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"builtin actor", `update app_user set builtin=true where id=$1`},
		{"nonbuiltin group", `update user_group set builtin=false where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor := fixture(t)
			service := targetpolicy.NewCIDRService(pool)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), tc.sql, actor.ID)
			require.NoError(t, err)
			out := make(chan error, 1)
			go func() {
				_, err := service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{"203.0.113.0/24"}, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-out, targetpolicy.ErrPermissionDenied)
			_, err = service.Get(t.Context(), actor)
			require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_cidr_denylist'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}

// TestCIDRConcurrentSaveOneWinner catches lost CAS, stale no-op acceptance,
// duplicate audits and replacement of a future monotonic version by wall time.
func TestCIDRConcurrentSaveOneWinner(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewCIDRService(pool)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	start, out := make(chan struct{}), make(chan error, 2)
	for _, address := range []string{"192.0.2.0/24", "203.0.113.0/24"} {
		go func() {
			<-start
			_, err := service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{address}, ExpectedUpdatedAt: current.UpdatedAt})
			out <- err
		}()
	}
	close(start)
	a, b := <-out, <-out
	require.True(t, a == nil && errors.Is(b, targetpolicy.ErrConflict) || b == nil && errors.Is(a, targetpolicy.ErrConflict))
	saved, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	same, err := service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: saved.Prefixes, ExpectedUpdatedAt: saved.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, saved, same)
	_, err = service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: saved.Prefixes, ExpectedUpdatedAt: current.UpdatedAt})
	require.ErrorIs(t, err, targetpolicy.ErrConflict)
	var count int
	var auditActor, fields string
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*),min(actor_id::text),min(changed_fields::text) from audit_log where resource_id='security.target_cidr_denylist'`).Scan(&count, &auditActor, &fields))
	require.Equal(t, 1, count)
	require.Equal(t, actor.ID, auditActor)
	require.Equal(t, "{security.target_cidr_denylist}", fields)
	_, err = pool.Exec(t.Context(), `update system_setting set updated_at='2099-01-01T00:00:00Z' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	future, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	next, err := service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{}, ExpectedUpdatedAt: future.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, "2099-01-01T00:00:00.000001Z", next.UpdatedAt)
}

// TestCIDRCancellationAndAuditRollback catches partial settings commits when audit
// fails, and writes continuing after cancellation during the shared policy wait.
func TestCIDRCancellationAndAuditRollback(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewCIDRService(pool)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `create function reject_cidr_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable'; end$$;create trigger reject_cidr before insert on audit_log for each row execute function reject_cidr_audit()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := pool.Exec(ctx, `drop trigger if exists reject_cidr on audit_log;drop function if exists reject_cidr_audit()`)
		require.NoError(t, err)
	})
	_, err = service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{"203.0.113.0/24"}, ExpectedUpdatedAt: current.UpdatedAt})
	require.Error(t, err)
	after, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, current, after)
	_, err = pool.Exec(t.Context(), `drop trigger reject_cidr on audit_log;drop function reject_cidr_audit()`)
	require.NoError(t, err)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer testdb.Rollback(t, tx.Rollback)
	require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	out := make(chan error, 1)
	go func() {
		_, err := service.Update(ctx, actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{"203.0.113.0/24"}, ExpectedUpdatedAt: current.UpdatedAt})
		out <- err
	}()
	waitBlocked(t, pool, tx.Conn().PgConn().PID())
	cancel()
	require.Error(t, <-out)
	require.NoError(t, tx.Rollback(t.Context()))
	after, err = service.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, current, after)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.target_cidr_denylist'`).Scan(&count))
	require.Zero(t, count)
}

// TestCIDRPolicyStorageAndLegacyRules catches corrupt sixth-resource defaults and
// an early denial/allow success hiding bad data in any other policy resource.
func TestCIDRPolicyStorageAndLegacyRules(t *testing.T) {
	pool, _, actor := fixture(t)
	service := targetpolicy.NewCIDRService(pool)
	require.NoError(t, service.ValidateStartup(t.Context()))
	for _, value := range []string{`null`, `{}`, `{"prefixes":null}`, `{"prefixes":["2001:DB8::/32"]}`, `{"prefixes":[],"extra":1}`} {
		_, err := pool.Exec(t.Context(), `update system_setting set value=$1 where key='security.target_cidr_denylist'`, value)
		require.NoError(t, err)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), targetpolicy.ErrCorrupt)
		_, err = service.Get(t.Context(), actor)
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		_, err = service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{}, ExpectedUpdatedAt: "2026-11-13T00:00:00Z"})
		require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
		require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example/"}), targetpolicy.ErrCorrupt)
	}
	_, err := pool.Exec(t.Context(), `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	for _, key := range []string{targetpolicy.Key, targetpolicy.AllowlistKey, targetpolicy.SuffixKey, targetpolicy.SuffixAllowlistKey, targetpolicy.IPKey} {
		var original string
		require.NoError(t, pool.QueryRow(t.Context(), `select value::text from system_setting where key=$1`, key).Scan(&original))
		_, err := pool.Exec(t.Context(), `update system_setting set value='{}' where key=$1`, key)
		require.NoError(t, err)
		require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://203.0.113.9/"}), targetpolicy.ErrCorrupt, key)
		_, err = pool.Exec(t.Context(), `update system_setting set value=$1 where key=$2`, original, key)
		require.NoError(t, err)
	}
	_, err = pool.Exec(t.Context(), `delete from system_setting where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), pgx.ErrNoRows)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, pgx.ErrNoRows)
	_, err = service.Update(t.Context(), actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{}, ExpectedUpdatedAt: "2026-11-13T00:00:00Z"})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(pool), []string{"https://safe.example/"}), pgx.ErrNoRows)
	for _, id := range []string{"", "guest", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-4000-8000-000000000001"} {
		_, err := service.Get(t.Context(), auth.CurrentUser{ID: id})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
		_, err = service.Update(t.Context(), auth.CurrentUser{ID: id}, targetpolicy.CIDRUpdateInput{})
		require.ErrorIs(t, err, targetpolicy.ErrPermissionDenied)
	}
	for _, input := range []targetpolicy.CIDRUpdateInput{{}, {Prefixes: []string{}, ExpectedUpdatedAt: "x"}, {Prefixes: []string{}, ExpectedUpdatedAt: "2026-11-13T00:00:00.1234567Z"}} {
		_, err := service.Update(t.Context(), actor, input)
		require.ErrorIs(t, err, targetpolicy.ErrInvalidInput)
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.Get(canceled, actor)
	require.Error(t, err)
	_, err = service.Update(canceled, actor, targetpolicy.CIDRUpdateInput{Prefixes: []string{}, ExpectedUpdatedAt: "2026-11-13T00:00:00Z"})
	require.Error(t, err)
}
