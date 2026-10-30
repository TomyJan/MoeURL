package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func footerLinksAppRollback(t *testing.T, tx pgx.Tx) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
		t.Errorf("footer App transaction cleanup: %v", err)
	}
}

// Losing a cookie's identity, reusing one actor for both requests, omitting the
// database CAS, or attributing audit to the loser must break this real HTTP test.
func TestFooterLinksIndependentSessionAdminsCAS(t *testing.T) {
	a := newTestApplication(t)
	login := func(username, password string) (*http.Cookie, auth.CurrentUser) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/auth/login", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":%q}`, username, password)))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		a.server.Handler.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		var response struct {
			Code int
			Data struct{ User auth.CurrentUser }
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Zero(t, response.Code)
		cookies := w.Result().Cookies()
		require.Len(t, cookies, 1)
		var me struct{ User auth.CurrentUser }
		require.NoError(t, json.Unmarshal(domainOrderRequest(t, a, cookies[0], "GET", "/api/v1/auth/me", ""), &me))
		require.Equal(t, response.Data.User, me.User)
		require.Equal(t, username, me.User.Username)
		require.Equal(t, "admin", me.User.GroupKey)
		return cookies[0], me.User
	}
	firstCookie, firstActor := login("admin", "secure-password")
	var created struct{ User struct{ ID string } }
	require.NoError(t, json.Unmarshal(domainOrderRequest(t, a, firstCookie, "POST", "/api/v1/admin/user/create", `{"username":"footer-admin","password":"second-secure-password","nickname":"Footer administrator","groupKey":"admin","status":"active"}`), &created))
	secondCookie, secondActor := login("footer-admin", "second-secure-password")
	require.Equal(t, created.User.ID, secondActor.ID)
	require.NotEqual(t, firstActor.ID, secondActor.ID)
	require.NotEqual(t, firstActor.Username, secondActor.Username)
	require.False(t, firstCookie.Value == secondCookie.Value, "independent logins must have distinct sessions")
	var administrators int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where ((u.id::text=$1 and u.username=$2) or (u.id::text=$3 and u.username=$4)) and u.status='active' and u.deleted_at is null and not u.builtin and g.builtin and g.key='admin'`, firstActor.ID, firstActor.Username, secondActor.ID, secondActor.Username).Scan(&administrators))
	require.Equal(t, 2, administrators)
	current := footerLinksCall(t, a, firstCookie, "GET", footerLinksAdminPath, "", "", 200, 0)
	require.Equal(t, []any{}, current["links"])
	require.Equal(t, current, footerLinksCall(t, a, secondCookie, "GET", footerLinksAdminPath, "", "", 200, 0))
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	tx, err := a.pool.Begin(ctx)
	require.NoError(t, err)
	defer footerLinksAppRollback(t, tx)
	_, err = tx.Exec(ctx, `select key from system_setting where key='site.footer_links' for update`)
	require.NoError(t, err)
	type outcome struct {
		actor    auth.CurrentUser
		label    string
		response *httptest.ResponseRecorder
	}
	ready, start, results, finished := make(chan struct{}, 2), make(chan struct{}), make(chan outcome, 2), make(chan struct{}, 2)
	t.Cleanup(func() {
		cancel()
		footerLinksAppRollback(t, tx)
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		for range 2 {
			select {
			case <-finished:
			case <-cleanup.Done():
				t.Error("independent footer HTTP writer did not terminate")
			}
		}
	})
	for _, writer := range []struct {
		actor  auth.CurrentUser
		cookie *http.Cookie
		label  string
	}{
		{firstActor, firstCookie, "First"}, {secondActor, secondCookie, "Second"},
	} {
		go func() {
			defer func() { finished <- struct{}{} }()
			ready <- struct{}{}
			<-start
			r := httptest.NewRequestWithContext(ctx, "POST", footerLinksUpdatePath, strings.NewReader(fmt.Sprintf(`{"links":[{"label":%q,"url":"https://docs.example/a/../b?A=b#FAQ"}],"expectedUpdatedAt":%q}`, writer.label, current["updatedAt"])))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(writer.cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			results <- outcome{writer.actor, writer.label, w}
		}()
	}
	<-ready
	<-ready
	close(start)
	require.Eventually(t, func() bool {
		var waiting int
		err := a.pool.QueryRow(ctx, `with recursive waiting(pid) as (select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))) select count(*) from waiting`, tx.Conn().PgConn().PID()).Scan(&waiting)
		return err == nil && waiting == 2
	}, 2*time.Second, 5*time.Millisecond, "both independent HTTP writers must actually queue")
	require.NoError(t, tx.Commit(ctx))
	codes := map[int]int{}
	var winner map[string]any
	var winnerID string
	for range 2 {
		var result outcome
		select {
		case result = <-results:
		case <-ctx.Done():
			t.Fatal("independent footer HTTP result timed out")
		}
		require.Equal(t, 200, result.response.Code)
		require.Equal(t, "no-store", result.response.Header().Get("Cache-Control"))
		var body struct {
			Code int
			Data map[string]any
		}
		require.NoError(t, json.Unmarshal(result.response.Body.Bytes(), &body))
		codes[body.Code]++
		if body.Code == 0 {
			require.Equal(t, []any{map[string]any{"label": result.label, "url": "https://docs.example/a/../b?A=b#FAQ"}}, body.Data["links"])
			winner, winnerID = body.Data, result.actor.ID
		}
	}
	require.Equal(t, map[int]int{0: 1, 900209: 1}, codes)
	previous, err := time.Parse(time.RFC3339Nano, current["updatedAt"].(string))
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339Nano, winner["updatedAt"].(string))
	require.NoError(t, err)
	require.True(t, next.After(previous))
	for _, cookie := range []*http.Cookie{firstCookie, secondCookie} {
		require.Equal(t, winner, footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0))
	}
	require.Equal(t, map[string]any{"links": winner["links"]}, footerLinksCall(t, a, nil, "GET", footerLinksPublicPath, "", "", 200, 0))
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.footer_links'`).Scan(&count))
	require.Equal(t, 1, count)
	var audit string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log where resource_id='site.footer_links'`).Scan(&audit))
	require.JSONEq(t, fmt.Sprintf(`{"actor":%q,"resource":"system_setting","id":"site.footer_links","action":"settings_change","fields":["site.footer_links"]}`, winnerID), audit)
}

// Real audit/storage errors must map to generic no-store 500 responses, never
// leak persisted targets or permit a partial replacement of an invalid row.
func TestFooterLinksHTTPStorageFailure(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0)
	var before string
	snapshot := func() string {
		t.Helper()
		var value string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('setting',(select to_jsonb(s) from system_setting s where key='site.footer_links'),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from audit_log a where resource_id='site.footer_links'))::text`).Scan(&value))
		return value
	}
	before = snapshot()
	_, err := a.pool.Exec(t.Context(), `create function footer_links_http_reject_audit() returns trigger language plpgsql as $$ begin raise exception 'footer audit unavailable'; end $$; create trigger footer_links_http_reject_audit before insert on audit_log for each row when (new.resource_id='site.footer_links') execute function footer_links_http_reject_audit()`)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := a.pool.Exec(ctx, `drop trigger if exists footer_links_http_reject_audit on audit_log; drop function if exists footer_links_http_reject_audit()`)
		require.NoError(t, err)
	})
	body := fmt.Sprintf(`{"links":[{"label":"Secret draft","url":"https://private.example/secret"}],"expectedUpdatedAt":%q}`, current["updatedAt"])
	require.Nil(t, footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, body, "application/json", 500, 900000))
	require.JSONEq(t, before, snapshot())
	require.Equal(t, current, footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0))
	_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"links":[{"label":"Secret stored","url":"javascript:secret-value"}]}'::jsonb where key='site.footer_links'`)
	require.NoError(t, err)
	before = snapshot()
	for _, path := range []string{footerLinksPublicPath, footerLinksAdminPath} {
		require.Nil(t, footerLinksCall(t, a, cookie, "GET", path, "", "", 500, 900000))
	}
	require.Nil(t, footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, body, "application/json", 500, 900000))
	require.JSONEq(t, before, snapshot())
}
