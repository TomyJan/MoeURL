package system_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func footerLinksFixture(t *testing.T) (*pgxpool.Pool, *system.FooterLinksService, auth.CurrentUser) {
	t.Helper()
	pool := systemTestPool(t, t.Context())
	require.NoError(t, system.NewService(pool, mustSetupPolicy(t, false, "")).Setup(t.Context(), validSetupInput("")))
	var id string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&id))
	return pool, system.NewFooterLinksService(pool), auth.CurrentUser{ID: id, Username: "admin", GroupKey: "admin"}
}

// The earliest rollback is bounded too, including assertion-failure paths.
func footerLinksRollback(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		t.Errorf("footer transaction cleanup: %v", err)
	}
}

func footerLinksSnapshot(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var snapshot string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('setting',(select to_jsonb(s) from system_setting s where key='site.footer_links'),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from audit_log a where resource_id='site.footer_links'))::text`).Scan(&snapshot))
	return snapshot
}

// Removing current-authority checks would let a queued writer use stale roles.
func TestFooterLinksQueuedRevocation(t *testing.T) {
	for _, revoke := range []struct{ name, sql string }{
		{"disabled_actor", `update app_user set status='disabled' where id=$1`},
		{"deleted_actor", `update app_user set deleted_at=now() where id=$1`},
		{"changed_membership", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"system_manage_revoked", `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"admin_access_revoked", `update user_group set permissions='["system:manage"]' where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(revoke.name, func(t *testing.T) {
			pool, service, actor := footerLinksFixture(t)
			current, err := service.GetFooterLinks(t.Context(), actor)
			require.NoError(t, err)
			before := footerLinksSnapshot(t, pool)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer footerLinksRollback(t, tx)
			_, err = tx.Exec(ctx, revoke.sql, actor.ID)
			require.NoError(t, err)
			result, finished := make(chan error, 1), make(chan struct{})
			t.Cleanup(func() {
				cancel()
				footerLinksRollback(t, tx)
				cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				select {
				case <-finished:
				case <-cleanup.Done():
					t.Error("revoked footer writer did not terminate")
				}
			})
			go func() {
				defer close(finished)
				_, err := service.UpdateFooterLinks(ctx, actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{{Label: "Revoked", URL: "https://revoked.example/"}}, ExpectedUpdatedAt: current.UpdatedAt})
				result <- err
			}()
			require.Eventually(t, func() bool {
				var blocked bool
				err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&blocked)
				return err == nil && blocked
			}, 2*time.Second, 5*time.Millisecond, "writer must really queue behind current-authority revocation")
			require.NoError(t, tx.Commit(ctx))
			select {
			case err := <-result:
				require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
			case <-ctx.Done():
				t.Fatal("revoked footer result timed out")
			}
			_, err = service.GetFooterLinks(ctx, actor)
			require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
			public, err := service.PublicFooterLinks(ctx)
			require.NoError(t, err)
			require.Equal(t, current.FooterLinks, public)
			require.JSONEq(t, before, footerLinksSnapshot(t, pool))
		})
	}
}

// Two independent real admins must produce one winner and its exact audit actor.
func TestFooterLinksIndependentAdminsCAS(t *testing.T) {
	pool, service, first := footerLinksFixture(t)
	created, err := user.NewService(pool, permission.NewDatabaseService(pool)).Create(t.Context(), first, user.CreateInput{Username: "footer-admin", Password: "second-secure-password", Nickname: "Footer administrator", GroupKey: "admin", Status: "active"})
	require.NoError(t, err)
	second := auth.CurrentUser{ID: created.User.ID, Username: created.User.Username, GroupKey: created.User.Group}
	require.NotEqual(t, first.ID, second.ID)
	var administrators int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where ((u.id::text=$1 and u.username='admin') or (u.id::text=$2 and u.username='footer-admin')) and u.status='active' and u.deleted_at is null and not u.builtin and g.builtin and g.key='admin'`, first.ID, second.ID).Scan(&administrators))
	require.Equal(t, 2, administrators)
	current, err := service.GetFooterLinks(t.Context(), first)
	require.NoError(t, err)
	require.Empty(t, current.Links)
	other, err := service.GetFooterLinks(t.Context(), second)
	require.NoError(t, err)
	require.Equal(t, current, other)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer footerLinksRollback(t, tx)
	_, err = tx.Exec(ctx, `select key from system_setting where key='site.footer_links' for update`)
	require.NoError(t, err)
	type outcome struct {
		actor    auth.CurrentUser
		links    []system.FooterLink
		settings system.FooterLinksSettings
		err      error
	}
	ready, start, results, finished := make(chan struct{}, 2), make(chan struct{}), make(chan outcome, 2), make(chan struct{}, 2)
	t.Cleanup(func() {
		cancel()
		footerLinksRollback(t, tx)
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		for range 2 {
			select {
			case <-finished:
			case <-cleanup.Done():
				t.Error("independent footer writer did not terminate")
			}
		}
	})
	for _, writer := range []struct {
		actor auth.CurrentUser
		links []system.FooterLink
	}{
		{first, []system.FooterLink{{Label: "First", URL: "https://first.example/"}, {Label: "First", URL: "https://first.example/"}}},
		{second, []system.FooterLink{{Label: "Second", URL: "http://localhost:8080/docs"}}},
	} {
		go func() {
			defer func() { finished <- struct{}{} }()
			ready <- struct{}{}
			<-start
			settings, err := service.UpdateFooterLinks(ctx, writer.actor, system.UpdateFooterLinksInput{Links: writer.links, ExpectedUpdatedAt: current.UpdatedAt})
			results <- outcome{writer.actor, writer.links, settings, err}
		}()
	}
	<-ready
	<-ready
	close(start)
	require.Eventually(t, func() bool {
		var waiting int
		err := pool.QueryRow(ctx, `with recursive waiting(pid) as (select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))) select count(*) from waiting`, tx.Conn().PgConn().PID()).Scan(&waiting)
		return err == nil && waiting == 2
	}, 2*time.Second, 5*time.Millisecond, "both independent writers must queue behind the actual resource lock")
	require.NoError(t, tx.Commit(ctx))
	var winner outcome
	successes, conflicts := 0, 0
	for range 2 {
		select {
		case result := <-results:
			if result.err == nil {
				successes++
				require.Equal(t, result.links, result.settings.Links)
				winner = result
			} else {
				conflicts++
				require.ErrorIs(t, result.err, system.ErrFooterLinksConflict)
			}
		case <-ctx.Done():
			t.Fatal("independent footer result timed out")
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, conflicts)
	previous, err := time.Parse(time.RFC3339Nano, current.UpdatedAt)
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339Nano, winner.settings.UpdatedAt)
	require.NoError(t, err)
	require.True(t, next.After(previous))
	for _, actor := range []auth.CurrentUser{first, second} {
		stored, err := service.GetFooterLinks(ctx, actor)
		require.NoError(t, err)
		require.Equal(t, winner.settings, stored)
	}
	public, err := service.PublicFooterLinks(ctx)
	require.NoError(t, err)
	require.Equal(t, winner.settings.FooterLinks, public)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id='site.footer_links'`).Scan(&count))
	require.Equal(t, 1, count)
	var audit string
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log where resource_id='site.footer_links'`).Scan(&audit))
	require.JSONEq(t, fmt.Sprintf(`{"actor":%q,"resource":"system_setting","id":"site.footer_links","action":"settings_change","fields":["site.footer_links"]}`, winner.actor.ID), audit)
}

// Cancellation/deadline while blocked must leave content, revision and audit intact.
func TestFooterLinksCanceledWriter(t *testing.T) {
	for _, timeout := range []bool{false, true} {
		name := "caller_cancel"
		if timeout {
			name = "caller_deadline"
		}
		t.Run(name, func(t *testing.T) {
			pool, service, actor := footerLinksFixture(t)
			current, err := service.GetFooterLinks(t.Context(), actor)
			require.NoError(t, err)
			before := footerLinksSnapshot(t, pool)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer footerLinksRollback(t, tx)
			_, err = tx.Exec(t.Context(), `select key from system_setting where key='site.footer_links' for update`)
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(t.Context())
			if timeout {
				cancel()
				ctx, cancel = context.WithTimeout(t.Context(), 2*time.Second)
			}
			defer cancel()
			result, finished := make(chan error, 1), make(chan struct{})
			t.Cleanup(func() {
				cancel()
				footerLinksRollback(t, tx)
				cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
				defer stop()
				select {
				case <-finished:
				case <-cleanup.Done():
					t.Error("canceled footer writer did not terminate")
				}
			})
			go func() {
				defer close(finished)
				_, err := service.UpdateFooterLinks(ctx, actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{{Label: "Canceled", URL: "https://cancel.example/"}}, ExpectedUpdatedAt: current.UpdatedAt})
				result <- err
			}()
			require.Eventually(t, func() bool {
				var blocked bool
				err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&blocked)
				return err == nil && blocked
			}, time.Second, 5*time.Millisecond)
			if !timeout {
				cancel()
			}
			select {
			case err := <-result:
				require.Error(t, err)
				if timeout {
					require.ErrorIs(t, ctx.Err(), context.DeadlineExceeded)
				} else {
					require.ErrorIs(t, ctx.Err(), context.Canceled)
				}
			case <-time.After(6 * time.Second):
				t.Fatal("canceled footer result timed out")
			}
			require.NoError(t, tx.Rollback(t.Context()))
			stored, err := service.GetFooterLinks(t.Context(), actor)
			require.NoError(t, err)
			require.Equal(t, current, stored)
			require.JSONEq(t, before, footerLinksSnapshot(t, pool))
		})
	}
}

// An actual audit insert failure must roll back the content and full revision.
func TestFooterLinksAuditFailureRollsBack(t *testing.T) {
	pool, service, actor := footerLinksFixture(t)
	current, err := service.GetFooterLinks(t.Context(), actor)
	require.NoError(t, err)
	before := footerLinksSnapshot(t, pool)
	_, err = pool.Exec(t.Context(), `create function footer_links_test_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'footer audit unavailable'; end $$; create trigger footer_links_test_reject_audit before insert on audit_log for each row when (new.resource_id='site.footer_links') execute function footer_links_test_reject_audit()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := pool.Exec(ctx, `drop trigger if exists footer_links_test_reject_audit on audit_log; drop function if exists footer_links_test_reject_audit()`)
		require.NoError(t, err)
	})
	_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{{Label: "Secret draft", URL: "https://private.example/secret"}}, ExpectedUpdatedAt: current.UpdatedAt})
	require.Error(t, err)
	require.JSONEq(t, before, footerLinksSnapshot(t, pool))
	stored, err := service.GetFooterLinks(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, current, stored)
}

// Invalid storage must not become an empty list or be repaired by a valid write.
func TestFooterLinksStartupAndStorageFailure(t *testing.T) {
	pool, service, actor := footerLinksFixture(t)
	require.NoError(t, service.ValidateStartup(t.Context()))
	for _, raw := range []string{`{}`, `{"links":null}`, `{"links":[{"label":"Bad","url":"javascript:alert(1)"}]}`, `{"links":[{"label":" Spaced ","url":"https://example.com/"}]}`} {
		_, err := pool.Exec(t.Context(), `update system_setting set value=$1::jsonb where key='site.footer_links'`, raw)
		require.NoError(t, err)
		before := footerLinksSnapshot(t, pool)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), system.ErrCorruptFooterLinks)
		_, err = service.GetFooterLinks(t.Context(), actor)
		require.ErrorIs(t, err, system.ErrCorruptFooterLinks)
		_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{}, ExpectedUpdatedAt: "2026-10-30T00:00:00Z"})
		require.ErrorIs(t, err, system.ErrCorruptFooterLinks)
		require.JSONEq(t, before, footerLinksSnapshot(t, pool))
	}
	_, err := pool.Exec(t.Context(), `delete from system_setting where key='site.footer_links'`)
	require.NoError(t, err)
	require.Error(t, service.ValidateStartup(t.Context()))
	_, err = service.GetFooterLinks(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{}, ExpectedUpdatedAt: "2026-10-30T00:00:00Z"})
	require.Error(t, err)
	pool.Close()
	require.Error(t, service.ValidateStartup(t.Context()))
	_, err = service.GetFooterLinks(t.Context(), actor)
	require.Error(t, err)
	_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{}, ExpectedUpdatedAt: "2026-10-30T00:00:00Z"})
	require.Error(t, err)
}

// Invalid identity/commands must fail before I/O, not panic on an absent pool.
func TestFooterLinksServiceRejectsInvalidCommands(t *testing.T) {
	service := system.NewFooterLinksService(nil)
	_, err := service.GetFooterLinks(t.Context(), auth.CurrentUser{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	_, err = service.UpdateFooterLinks(t.Context(), auth.CurrentUser{}, system.UpdateFooterLinksInput{})
	require.ErrorIs(t, err, system.ErrSettingsPermissionDenied)
	actor := auth.CurrentUser{ID: "a0000000-0000-0000-0000-000000000001"}
	_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{})
	require.ErrorIs(t, err, system.ErrInvalidFooterLinks)
	_, err = service.UpdateFooterLinks(t.Context(), actor, system.UpdateFooterLinksInput{Links: []system.FooterLink{}, ExpectedUpdatedAt: "tomorrow"})
	require.ErrorIs(t, err, system.ErrInvalidFooterLinks)
}
