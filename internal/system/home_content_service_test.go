package system_test

import (
	"context"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func homeContentFixture(t *testing.T) (*pgxpool.Pool, *system.HomeContentService, auth.CurrentUser) {
	t.Helper()
	pool := systemTestPool(t, t.Context())
	require.NoError(t, system.NewService(pool, mustSetupPolicy(t, false, "")).Setup(t.Context(), validSetupInput("")))
	var id string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&id))
	return pool, system.NewHomeContentService(pool), auth.CurrentUser{ID: id, GroupKey: "admin"}
}

// The writer must actually wait behind a revocation transaction, then observe
// the committed current identity rather than the request's cached admin role.
func TestHomeContentQueuedRevocation(t *testing.T) {
	for _, revoke := range []struct{ name, sql string }{
		{"disabled actor", `update app_user set status='disabled' where id=$1`},
		{"deleted actor", `update app_user set deleted_at=now() where id=$1`},
		{"changed membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"group permission", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(revoke.name, func(t *testing.T) {
			pool, service, actor := homeContentFixture(t)
			current, err := service.GetHomeContent(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, tx.Rollback) }()
			_, err = tx.Exec(t.Context(), revoke.sql, actor.ID)
			require.NoError(t, err)
			pid := tx.Conn().PgConn().PID()
			result := make(chan error, 1)
			go func() {
				_, err := service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{Title: "must not save", ExpectedUpdatedAt: current.UpdatedAt})
				result <- err
			}()
			require.Eventually(t, func() bool {
				var blocked bool
				err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, pid).Scan(&blocked)
				return err == nil && blocked
			}, 2*time.Second, 5*time.Millisecond, "writer must be observed waiting on the revocation")
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-result, system.ErrSettingsPermissionDenied)
			_, err = service.GetHomeContent(t.Context(), actor)
			require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
			public, err := service.PublicHomeContent(t.Context())
			require.NoError(t, err)
			require.Equal(t, current.HomeContent, public)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.home_content'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}

// Concurrent equal-revision writes must produce one persisted winner and one
// conflict, and exactly one audit record naming only this independent setting.
func TestHomeContentConcurrentCAS(t *testing.T) {
	pool, service, actor := homeContentFixture(t)
	current, err := service.GetHomeContent(t.Context(), actor)
	require.NoError(t, err)
	type outcome struct {
		content system.HomeContentSettings
		err     error
	}
	ready, start, results := make(chan struct{}, 2), make(chan struct{}), make(chan outcome, 2)
	for _, title := range []string{"first", "second"} {
		go func() {
			ready <- struct{}{}
			<-start
			content, err := service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{Title: title, ExpectedUpdatedAt: current.UpdatedAt})
			results <- outcome{content, err}
		}()
	}
	<-ready
	<-ready
	close(start)
	a, b := <-results, <-results
	if a.err != nil {
		a, b = b, a
	}
	require.NoError(t, a.err)
	require.ErrorIs(t, b.err, system.ErrHomeContentConflict)
	stored, err := service.GetHomeContent(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, a.content, stored)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.home_content'`).Scan(&count))
	require.Equal(t, 1, count)
}

// Cancellation while a real content-row lock is held must return without a
// partial write; the same pool remains usable after the caller leaves.
func TestHomeContentCanceledWriter(t *testing.T) {
	pool, service, actor := homeContentFixture(t)
	current, err := service.GetHomeContent(t.Context(), actor)
	require.NoError(t, err)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	_, err = tx.Exec(t.Context(), `select key from system_setting where key='site.home_content' for update`)
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := service.UpdateHomeContent(ctx, actor, system.UpdateHomeContentInput{Title: "canceled", ExpectedUpdatedAt: current.UpdatedAt})
		result <- err
	}()
	require.Eventually(t, func() bool {
		var blocked bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&blocked)
		return err == nil && blocked
	}, 2*time.Second, 5*time.Millisecond)
	cancel()
	require.Error(t, <-result)
	require.NoError(t, tx.Rollback(t.Context()))
	stored, err := service.GetHomeContent(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, current, stored)
}

func TestHomeContentStartupAndStorageFailure(t *testing.T) {
	pool, service, actor := homeContentFixture(t)
	require.NoError(t, service.ValidateStartup(t.Context()))
	_, err := pool.Exec(t.Context(), `update system_setting set value='{}' where key='site.home_content'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), system.ErrCorruptHomeContent)
	_, err = service.GetHomeContent(t.Context(), actor)
	require.ErrorIs(t, err, system.ErrCorruptHomeContent)
	_, err = service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.ErrorIs(t, err, system.ErrCorruptHomeContent)
	_, err = pool.Exec(t.Context(), `delete from system_setting where key='site.home_content'`)
	require.NoError(t, err)
	_, err = service.GetHomeContent(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.Error(t, err)
	pool.Close()
	require.Error(t, service.ValidateStartup(t.Context()))
	_, err = service.GetHomeContent(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.Error(t, err)
}

// Invalid identities and malformed commands must fail before attempting I/O.
func TestHomeContentServiceRejectsInvalidCommands(t *testing.T) {
	service := system.NewHomeContentService(nil)
	_, err := service.GetHomeContent(t.Context(), auth.CurrentUser{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	_, err = service.UpdateHomeContent(t.Context(), auth.CurrentUser{}, system.UpdateHomeContentInput{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	actor := auth.CurrentUser{ID: "a0000000-0000-0000-0000-000000000001"}
	_, err = service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{Title: "\n"})
	require.ErrorIs(t, err, system.ErrInvalidHomeContent)
	_, err = service.UpdateHomeContent(t.Context(), actor, system.UpdateHomeContentInput{ExpectedUpdatedAt: "tomorrow"})
	require.ErrorIs(t, err, system.ErrInvalidHomeContent)
}
