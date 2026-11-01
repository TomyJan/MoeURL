package system_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func appearanceFixture(t *testing.T) (*pgxpool.Pool, *system.AppearanceService, auth.CurrentUser) {
	t.Helper()
	pool := systemTestPool(t, t.Context())
	require.NoError(t, system.NewService(pool, mustSetupPolicy(t, false, "")).Setup(t.Context(), validSetupInput("")))
	var id string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&id))
	return pool, system.NewAppearanceService(pool), auth.CurrentUser{ID: id, GroupKey: "admin"}
}

// The writer must actually wait behind a revocation transaction, then observe
// the committed current identity rather than the request's cached admin role.
func TestAppearanceQueuedRevocation(t *testing.T) {
	for _, revoke := range []struct{ name, sql string }{
		{"disabled actor", `update app_user set status='disabled' where id=$1`},
		{"deleted actor", `update app_user set deleted_at=now() where id=$1`},
		{"changed membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"system manage permission", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"admin access permission", `update user_group set permissions='["system:manage"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(revoke.name, func(t *testing.T) {
			pool, service, actor := appearanceFixture(t)
			current, err := service.GetAppearance(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, tx.Rollback) }()
			_, err = tx.Exec(t.Context(), revoke.sql, actor.ID)
			require.NoError(t, err)
			pid := tx.Conn().PgConn().PID()
			result := make(chan error, 1)
			go func() {
				_, err := service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "forest", ExpectedUpdatedAt: current.UpdatedAt})
				result <- err
			}()
			require.Eventually(t, func() bool {
				var blocked bool
				err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, pid).Scan(&blocked)
				return err == nil && blocked
			}, 2*time.Second, 5*time.Millisecond, "writer must be observed waiting on the revocation")
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-result, system.ErrSettingsPermissionDenied)
			_, err = service.GetAppearance(t.Context(), actor)
			require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
			public, err := service.PublicAppearance(t.Context())
			require.NoError(t, err)
			require.Equal(t, current.Appearance, public)
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}

// Concurrent equal-revision writes must produce one persisted winner and one
// conflict, and exactly one audit record naming only this independent setting.
func TestAppearanceConcurrentCAS(t *testing.T) {
	pool, service, actor := appearanceFixture(t)
	current, err := service.GetAppearance(t.Context(), actor)
	require.NoError(t, err)
	type outcome struct {
		content system.AppearanceSettings
		err     error
	}
	ready, start, results := make(chan struct{}, 2), make(chan struct{}), make(chan outcome, 2)
	for _, title := range []string{"ocean", "forest"} {
		go func() {
			ready <- struct{}{}
			<-start
			content, err := service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: title, ExpectedUpdatedAt: current.UpdatedAt})
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
	require.ErrorIs(t, b.err, system.ErrAppearanceConflict)
	stored, err := service.GetAppearance(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, a.content, stored)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAppearanceIndependentAdminsCAS detects cross-actor lost updates and audit
// attribution to the losing administrator, using actual database identities.
func TestAppearanceIndependentAdminsCAS(t *testing.T) {
	pool, service, firstActor := appearanceFixture(t)
	created, err := user.NewService(pool, permission.NewDatabaseService(pool)).Create(t.Context(), firstActor, user.CreateInput{Username: "accent-admin", Password: "second-secure-password", Nickname: "Second administrator", GroupKey: "admin", Status: "active"})
	require.NoError(t, err)
	secondActor := auth.CurrentUser{ID: created.User.ID, Username: created.User.Username, GroupKey: created.User.Group}
	require.NotEqual(t, firstActor.ID, secondActor.ID)
	var administrators int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where ((u.id::text=$1 and u.username='admin') or (u.id::text=$2 and u.username='accent-admin')) and u.status='active' and u.deleted_at is null and not u.builtin and g.builtin and g.key='admin'`, firstActor.ID, secondActor.ID).Scan(&administrators))
	require.Equal(t, 2, administrators)
	current, err := service.GetAppearance(t.Context(), firstActor)
	require.NoError(t, err)
	require.Equal(t, "iris", current.AccentPreset)
	secondCurrent, err := service.GetAppearance(t.Context(), secondActor)
	require.NoError(t, err)
	require.Equal(t, current, secondCurrent)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	_, err = tx.Exec(t.Context(), `select key from system_setting where key='site.appearance' for update`)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	type outcome struct {
		actor    auth.CurrentUser
		preset   string
		settings system.AppearanceSettings
		err      error
	}
	ready, start := make(chan struct{}, 2), make(chan struct{})
	results, finished := make(chan outcome, 2), make(chan struct{}, 2)
	for _, writer := range []struct {
		actor  auth.CurrentUser
		preset string
	}{{firstActor, "ocean"}, {secondActor, "forest"}} {
		go func() {
			defer func() { finished <- struct{}{} }()
			ready <- struct{}{}
			<-start
			settings, err := service.UpdateAppearance(ctx, writer.actor, system.UpdateAppearanceInput{AccentPreset: writer.preset, ExpectedUpdatedAt: current.UpdatedAt})
			results <- outcome{writer.actor, writer.preset, settings, err}
		}()
	}
	<-ready
	<-ready
	close(start)
	t.Cleanup(func() {
		cancel()
		cleanupContext, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		_ = tx.Rollback(cleanupContext)
		for range 2 {
			select {
			case <-finished:
			case <-cleanupContext.Done():
				t.Error("independent appearance writer did not terminate")
			}
		}
	})
	require.Eventually(t, func() bool {
		var waiting int
		err := pool.QueryRow(ctx, `with recursive waiting(pid) as (select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))) select count(*) from waiting`, tx.Conn().PgConn().PID()).Scan(&waiting)
		return err == nil && waiting == 2
	}, 2*time.Second, 5*time.Millisecond, "both independent writers must queue behind the real setting lock")
	require.NoError(t, tx.Commit(ctx))
	var winner outcome
	successes, conflicts := 0, 0
	for range 2 {
		var result outcome
		select {
		case result = <-results:
		case <-ctx.Done():
			t.Fatal("independent appearance result timed out")
		}
		if result.err == nil {
			successes++
			require.Equal(t, result.preset, result.settings.AccentPreset)
			winner = result
		} else {
			conflicts++
			require.ErrorIs(t, result.err, system.ErrAppearanceConflict)
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, conflicts)
	previous, err := time.Parse(time.RFC3339Nano, current.UpdatedAt)
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339Nano, winner.settings.UpdatedAt)
	require.NoError(t, err)
	require.True(t, next.After(previous))
	for _, actor := range []auth.CurrentUser{firstActor, secondActor} {
		stored, err := service.GetAppearance(t.Context(), actor)
		require.NoError(t, err)
		require.Equal(t, winner.settings, stored)
	}
	public, err := service.PublicAppearance(t.Context())
	require.NoError(t, err)
	require.Equal(t, winner.settings.Appearance, public)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
	require.Equal(t, 1, count)
	var audit string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log where resource_id='site.appearance'`).Scan(&audit))
	require.JSONEq(t, fmt.Sprintf(`{"actor":%q,"resource":"system_setting","id":"site.appearance","action":"settings_change","fields":["site.appearance"]}`, winner.actor.ID), audit)
}

// Cancellation while a real content-row lock is held must return without a
// partial write; the same pool remains usable after the caller leaves.
func TestAppearanceCanceledWriter(t *testing.T) {
	pool, service, actor := appearanceFixture(t)
	current, err := service.GetAppearance(t.Context(), actor)
	require.NoError(t, err)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	_, err = tx.Exec(t.Context(), `select key from system_setting where key='site.appearance' for update`)
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := service.UpdateAppearance(ctx, actor, system.UpdateAppearanceInput{AccentPreset: "ocean", ExpectedUpdatedAt: current.UpdatedAt})
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
	stored, err := service.GetAppearance(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, current, stored)
}

func TestAppearanceStartupAndStorageFailure(t *testing.T) {
	pool, service, actor := appearanceFixture(t)
	require.NoError(t, service.ValidateStartup(t.Context()))
	_, err := pool.Exec(t.Context(), `update system_setting set value='{}' where key='site.appearance'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), system.ErrCorruptAppearance)
	_, err = service.GetAppearance(t.Context(), actor)
	require.ErrorIs(t, err, system.ErrCorruptAppearance)
	_, err = service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "ocean", ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.ErrorIs(t, err, system.ErrCorruptAppearance)
	_, err = pool.Exec(t.Context(), `delete from system_setting where key='site.appearance'`)
	require.NoError(t, err)
	_, err = service.GetAppearance(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "ocean", ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.Error(t, err)
	pool.Close()
	require.Error(t, service.ValidateStartup(t.Context()))
	_, err = service.GetAppearance(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "ocean", ExpectedUpdatedAt: "2026-10-29T00:00:00Z"})
	require.Error(t, err)
}

// Invalid identities and malformed commands must fail before attempting I/O.
func TestAppearanceServiceRejectsInvalidCommands(t *testing.T) {
	service := system.NewAppearanceService(nil)
	_, err := service.GetAppearance(t.Context(), auth.CurrentUser{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	_, err = service.UpdateAppearance(t.Context(), auth.CurrentUser{}, system.UpdateAppearanceInput{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	actor := auth.CurrentUser{ID: "a0000000-0000-0000-0000-000000000001"}
	_, err = service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "unknown"})
	require.ErrorIs(t, err, system.ErrInvalidAppearance)
	_, err = service.UpdateAppearance(t.Context(), actor, system.UpdateAppearanceInput{AccentPreset: "ocean", ExpectedUpdatedAt: "tomorrow"})
	require.ErrorIs(t, err, system.ErrInvalidAppearance)
}
