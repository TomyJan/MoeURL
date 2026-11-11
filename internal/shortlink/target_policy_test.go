package shortlink_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func targetWriteFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	insertShortLinkDefaultDomain(t, t.Context(), pool)
	actor := insertShortLinkUser(t, t.Context(), pool, "target-admin", "admin", permission.AdminPermissions)
	// A static entry snapshot deliberately lets the transaction prove that current
	// stored identity and grants, rather than the entry snapshot, control the write.
	return pool, shortlink.NewService(pool, permission.NewService()), actor
}

func waitTargetWriteBlocked(t *testing.T, pool *pgxpool.Pool, blocker uint32) {
	t.Helper()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid)))`, blocker).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond, "the command must really be queued in PostgreSQL")
}

// TestTargetPolicyWriteEntrypoints catches omitted policy checks, response-code
// drift, owner information leaks and accidental checks of unchanged target bytes.
func TestTargetPolicyWriteEntrypoints(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	ctx := t.Context()
	created, err := service.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://blocked.example/original"})
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(ctx, actor.ID)
	require.NoError(t, err)
	call := func(handler http.HandlerFunc, body string, want int) {
		t.Helper()
		r := httptest.NewRequestWithContext(ctx, "POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		w := httptest.NewRecorder()
		auth.CurrentUserMiddleware(auth.NewService(pool, time.Hour))(handler).ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		var response struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, want, response.Code, w.Body.String())
	}
	var auditBefore string
	require.NoError(t, pool.QueryRow(ctx, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a`).Scan(&auditBefore))
	call(shortlink.NewHandler(service).Create, `{"targetUrl":"https://blocked.example/new"}`, 200121)
	call(shortlink.NewBulkCreateHandler(service, nil).BatchCreate, `{"requestId":"61000000-0000-4000-8000-000000000001","targetUrls":["https://safe.example/a","https://blocked.example/b"]}`, 200121)
	var links, receipts int
	var auditAfter string
	require.NoError(t, pool.QueryRow(ctx, `select (select count(*) from short_link),(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a),(select count(*) from short_link_create_batch)`).Scan(&links, &auditAfter, &receipts))
	require.Equal(t, 1, links)
	require.Zero(t, receipts)
	require.Equal(t, auditBefore, auditAfter)
	for _, update := range []func(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error){service.Update, service.AdminUpdate} {
		target := "https://blocked.example/changed"
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target})
		require.ErrorIs(t, err, shortlink.ErrTargetDenied)
		target = created.ShortLink.TargetURL
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target})
		require.NoError(t, err)
		mode := "direct"
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target, RedirectMode: &mode})
		require.NoError(t, err)
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: uuid.NewString(), TargetURL: &target})
		require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	}
	_, err = service.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://sub.blocked.example/"})
	require.NoError(t, err)
	_, err = service.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://bad_host.example/"})
	require.ErrorIs(t, err, shortlink.ErrInvalidTargetURL)
	other := insertShortLinkUserForGroup(t, ctx, pool, "target-other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "admin", permission.AdminPermissions)
	target := "https://blocked.example/changed"
	_, err = service.Update(ctx, other, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing, "ownership must be checked before a policy result")
	_, err = pool.Exec(ctx, `delete from system_setting where key='security.target_host_denylist'`)
	require.NoError(t, err)
	for _, update := range []func(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error){service.Update, service.AdminUpdate} {
		status := "active"
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, Status: &status})
		require.NoError(t, err, "omitted target must not read the policy")
		target = created.ShortLink.TargetURL
		_, err = update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target})
		require.NoError(t, err, "locked identical target must not read the policy")
	}
}

// TestTargetPolicyCommittedReceiptReplay catches checking a later policy before
// an already committed receipt, or returning a receipt after authority is lost.
func TestTargetPolicyCommittedReceiptReplay(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	input := shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://blocked.example/original"}}
	first, err := service.BatchCreate(t.Context(), actor, input)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	again, err := service.BatchCreate(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, first, again)
	changed := input
	changed.TargetURLs = []string{"https://safe.example/changed"}
	_, err = service.BatchCreate(t.Context(), actor, changed)
	require.ErrorIs(t, err, shortlink.ErrBulkCreateConflict)
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:create' where key='admin'`)
	require.NoError(t, err)
	_, err = service.BatchCreate(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestTargetPolicyQueuedWriterRevocation catches trusting identity or grants
// captured before waiting for the policy gate, including administrator changes.
func TestTargetPolicyQueuedWriterRevocation(t *testing.T) {
	for _, command := range []string{"create", "batch", "own", "admin"} {
		for _, revocation := range []string{"disabled", "grant"} {
			t.Run(command+"/"+revocation, func(t *testing.T) {
				pool, service, actor := targetWriteFixture(t)
				created, err := service.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://safe.example/original"})
				require.NoError(t, err)
				var auditBefore string
				require.NoError(t, pool.QueryRow(t.Context(), `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a`).Scan(&auditBefore))
				tx, err := pool.Begin(t.Context())
				require.NoError(t, err)
				defer testdb.Rollback(t, tx.Rollback)
				require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
				if revocation == "disabled" {
					_, err = tx.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
				} else {
					_, err = tx.Exec(t.Context(), `update user_group set permissions='[]' where key='admin'`)
				}
				require.NoError(t, err)
				result := make(chan error, 1)
				go func() { result <- targetWriteCommand(t.Context(), service, actor, command, created.ShortLink.ID) }()
				waitTargetWriteBlocked(t, pool, tx.Conn().PgConn().PID())
				require.NoError(t, tx.Commit(t.Context()))
				want := shortlink.ErrPermissionDenied
				if command == "create" && revocation == "grant" {
					want = shortlink.ErrDomainUnavailable
				}
				require.ErrorIs(t, <-result, want)
				var count, receipts int
				var target, auditAfter string
				require.NoError(t, pool.QueryRow(t.Context(), `select count(*),min(target_url),(select count(*) from short_link_create_batch),(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a) from short_link`).Scan(&count, &target, &receipts, &auditAfter))
				require.Equal(t, 1, count)
				require.Equal(t, "https://safe.example/original", target)
				require.Zero(t, receipts)
				require.Equal(t, auditBefore, auditAfter)
			})
		}
	}
}

// TestTargetPolicyQueuedWriterCancellation catches a canceled gate wait
// continuing into a write or leaving a partial link, receipt or audit record.
func TestTargetPolicyQueuedWriterCancellation(t *testing.T) {
	for _, command := range []string{"create", "batch", "own", "admin"} {
		t.Run(command, func(t *testing.T) {
			pool, service, actor := targetWriteFixture(t)
			created, err := service.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://safe.example/original"})
			require.NoError(t, err)
			var before string
			require.NoError(t, pool.QueryRow(t.Context(), `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a`).Scan(&before))
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			result := make(chan error, 1)
			go func() { result <- targetWriteCommand(ctx, service, actor, command, created.ShortLink.ID) }()
			waitTargetWriteBlocked(t, pool, tx.Conn().PgConn().PID())
			cancel()
			require.Error(t, <-result)
			require.NoError(t, tx.Rollback(t.Context()))
			var after, target string
			var links, receipts int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*),min(target_url),(select count(*) from short_link_create_batch),(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]')::text from audit_log a) from short_link`).Scan(&links, &target, &receipts, &after))
			require.Equal(t, 1, links)
			require.Zero(t, receipts)
			require.Equal(t, "https://safe.example/original", target)
			require.Equal(t, before, after)
		})
	}
}

func targetWriteCommand(ctx context.Context, service *shortlink.Service, actor auth.CurrentUser, command, id string) error {
	target := "https://safe.example/changed"
	switch command {
	case "create":
		_, err := service.Create(ctx, actor, shortlink.CreateInput{TargetURL: target})
		return err
	case "batch":
		_, err := service.BatchCreate(ctx, actor, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{target}})
		return err
	case "own":
		_, err := service.Update(ctx, actor, shortlink.UpdateInput{ID: id, TargetURL: &target})
		return err
	case "admin":
		_, err := service.AdminUpdate(ctx, actor, shortlink.UpdateInput{ID: id, TargetURL: &target})
		return err
	default:
		return fmt.Errorf("unknown test command %s", command)
	}
}

// TestTargetPolicyStoredWriterIdentity catches accepting noncanonical actors,
// nonbuiltin/guest groups and malformed stored grants after the entry snapshot.
func TestTargetPolicyStoredWriterIdentity(t *testing.T) {
	for _, state := range []string{"noncanonical", "deleted", "nonbuiltin", "guest", "corrupt"} {
		t.Run(state, func(t *testing.T) {
			pool, service, actor := targetWriteFixture(t)
			var err error
			switch state {
			case "noncanonical":
				actor.ID = strings.ReplaceAll(actor.ID, "-", "")
			case "deleted":
				_, err = pool.Exec(t.Context(), `update app_user set deleted_at=now() where id=$1`, actor.ID)
			case "nonbuiltin":
				_, err = pool.Exec(t.Context(), `update user_group set builtin=false where key='admin'`)
			case "guest":
				_, err = pool.Exec(t.Context(), `update user_group set key='guest' where key='admin'`)
			case "corrupt":
				_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where key='admin'`)
			}
			require.NoError(t, err)
			_, err = service.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://safe.example/"})
			require.Error(t, err)
			if state == "noncanonical" {
				require.ErrorContains(t, err, "invalid audit actor")
			} else if state != "corrupt" {
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			}
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
			require.Zero(t, count)
		})
	}
}
