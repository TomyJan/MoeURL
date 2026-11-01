package app

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
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

const appearancePublicPath = "/api/v1/system/appearance"
const appearanceAdminPath = "/api/v1/admin/system/appearance"
const appearanceUpdatePath = appearanceAdminPath + "/update"

// appearanceCall exercises actual App/session/PG wiring, including no-store and
// sanitized failures; no fake service can satisfy these persistence assertions.
func appearanceCall(t *testing.T, a *App, cookie *http.Cookie, method, path, body, media string, status, code int) map[string]any {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	if media != "" {
		r.Header.Set("Content-Type", media)
	}
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(w, r)
	require.Equal(t, status, w.Code, "%s", w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var result struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, code, result.Code, "%s", w.Body.String())
	if status == 500 {
		require.NotContains(t, w.Body.String(), "site.appearance")
		require.NotContains(t, w.Body.String(), "appearance audit unavailable")
	}
	return result.Data
}

// TestAppearanceAPI detects missing routes, widened legacy DTOs, lost revisions,
// stale no-ops and saves of old resources clearing the independent accent.
func TestAppearanceAPI(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	t.Run("minimal public projection", func(t *testing.T) {
		require.Equal(t, map[string]any{"accentPreset": "iris"}, appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 200, 0))
	})
	t.Run("presets CAS audit and independent resources", func(t *testing.T) {
		current := appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0)
		require.Len(t, current, 2)
		var legacyBefore string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.appearance'`).Scan(&legacyBefore))
		for _, preset := range []string{"ocean", "forest", "iris"} {
			version := current["updatedAt"].(string)
			oldTime, err := time.Parse(time.RFC3339Nano, version)
			require.NoError(t, err)
			body := fmt.Sprintf(`{"accentPreset":%q,"expectedUpdatedAt":%q}`, preset, version)
			current = appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, body, "application/json", 200, 0)
			require.Equal(t, preset, current["accentPreset"])
			nextTime, err := time.Parse(time.RFC3339Nano, current["updatedAt"].(string))
			require.NoError(t, err)
			require.True(t, nextTime.After(oldTime))
			require.Equal(t, map[string]any{"accentPreset": preset}, appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 200, 0))
			appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, body, "application/json", 200, 900207)
			body = fmt.Sprintf(`{"accentPreset":%q,"expectedUpdatedAt":%q}`, preset, current["updatedAt"])
			require.Equal(t, current, appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, body, "application/json", 200, 0))
		}
		var legacyAfter string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.appearance'`).Scan(&legacyAfter))
		require.Equal(t, legacyBefore, legacyAfter)
		var history int
		require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&history))
		require.Equal(t, 3, history)
		for _, path := range []string{"/api/v1/admin/system/settings", homeContentAdminPath} {
			old := appearanceCall(t, a, cookie, "GET", path, "", "", 200, 0)
			require.NotContains(t, old, "accentPreset")
			old["expectedUpdatedAt"] = old["updatedAt"]
			delete(old, "updatedAt")
			if path == homeContentAdminPath {
				old["title"] = "Independent homepage"
			} else {
				old["siteName"] = "Independent general"
			}
			body, err := json.Marshal(old)
			require.NoError(t, err)
			appearanceCall(t, a, cookie, "POST", path+"/update", string(body), "application/json", 200, 0)
			require.Equal(t, current, appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0))
		}
		require.Len(t, appearanceCall(t, a, nil, "GET", "/api/v1/system/public-config", "", "", 200, 0), 5)
		require.Len(t, appearanceCall(t, a, nil, "GET", "/api/v1/system/home-content", "", "", 200, 0), 2)
	})
}

// TestAppearanceStrictProtocol checks complete commands and media types using
// a real session, preserving persisted values, revisions and history on denial.
func TestAppearanceStrictProtocol(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var revision time.Time
	require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at from system_setting where key='site.appearance'`).Scan(&revision))
	version := revision.UTC().Format(time.RFC3339Nano)
	valid := fmt.Sprintf(`{"accentPreset":"ocean","expectedUpdatedAt":%q}`, version)
	for _, tc := range []struct{ name, body string }{
		{"empty", ""}, {"null", "null"}, {"array", "[]"},
		{"missing preset", fmt.Sprintf(`{"expectedUpdatedAt":%q}`, version)},
		{"missing version", `{"accentPreset":"ocean"}`},
		{"null preset", strings.Replace(valid, `"ocean"`, "null", 1)},
		{"null version", `{"accentPreset":"ocean","expectedUpdatedAt":null}`},
		{"wrong type", strings.Replace(valid, `"ocean"`, "4", 1)},
		{"unknown field", strings.Replace(valid, `"accentPreset"`, `"extra":true,"accentPreset"`, 1)},
		{"trailing object", valid + " {}"}, {"trailing junk", valid + " x"},
		{"invalid utf8", strings.Replace(valid, "ocean", string([]byte{0xff}), 1)},
		{"over 8 KiB", valid + strings.Repeat(" ", 8192)},
		{"unknown preset", strings.Replace(valid, "ocean", "custom", 1)},
		{"empty preset", strings.Replace(valid, "ocean", "", 1)},
		{"padded preset", strings.Replace(valid, "ocean", " ocean ", 1)},
		{"case sensitive preset", strings.Replace(valid, "ocean", "Ocean", 1)},
		{"bad version", strings.Replace(valid, version, "yesterday", 1)},
		{"zero version", strings.Replace(valid, version, "0001-01-01T00:00:00Z", 1)},
		{"no timezone", strings.Replace(valid, version, "2026-10-30T01:02:03", 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, tc.body, "application/json", 200, 900206)
		})
	}
	for _, media := range []string{"", "text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "application/json; charset", "application/jsonp"} {
		t.Run("reject media "+media, func(t *testing.T) {
			appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, valid, media, 200, 900206)
		})
	}
	var after time.Time
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at from system_setting where key='site.appearance'`).Scan(&after))
	require.True(t, revision.Equal(after))
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
	require.Zero(t, count)
	for i, media := range []string{"application/json", "application/json; charset=utf-8", "Application/JSON; Charset=UTF-8"} {
		current := appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0)
		body := fmt.Sprintf(`{"accentPreset":%q,"expectedUpdatedAt":%q}`, []string{"ocean", "forest", "iris"}[i], current["updatedAt"])
		appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, body, media, 200, 0)
	}
}

func TestAppearanceCurrentPermissions(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, path := range []string{appearanceAdminPath, appearanceUpdatePath} {
		method := "GET"
		if path == appearanceUpdatePath {
			method = "POST"
		}
		appearanceCall(t, a, nil, method, path, `{"accentPreset":"ocean","expectedUpdatedAt":"2026-10-30T00:00:00Z"}`, "application/json", 200, 120001)
	}
	for _, grants := range []string{`[]`, `["admin:access"]`, `["system:manage"]`} {
		_, err := a.pool.Exec(t.Context(), `update user_group set permissions=$1 where key='admin'`, grants)
		require.NoError(t, err)
		appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 120001)
		appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, `{"accentPreset":"ocean","expectedUpdatedAt":"2026-10-30T00:00:00Z"}`, "application/json", 200, 120001)
	}
	appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 200, 0)
}

func TestAppearanceAuditRollback(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0)
	_, err := a.pool.Exec(t.Context(), `create function fail_appearance_audit() returns trigger language plpgsql as $$ begin raise exception 'appearance audit unavailable'; end $$; create trigger fail_appearance_audit before insert on audit_log for each row execute function fail_appearance_audit()`)
	require.NoError(t, err)
	body := fmt.Sprintf(`{"accentPreset":"forest","expectedUpdatedAt":%q}`, current["updatedAt"])
	appearanceCall(t, a, cookie, "POST", appearanceUpdatePath, body, "application/json", 500, 900000)
	require.Equal(t, current, appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0))
}

func TestAppearanceCorruptStorage(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, value := range []string{`null`, `{}`, `{"accentPreset":null}`, `{"accentPreset":"iris","extra":true}`, `{"accentPreset":" iris "}`, `{"accentPreset":"custom"}`} {
		_, err := a.pool.Exec(t.Context(), `update system_setting set value=$1 where key='site.appearance'`, value)
		require.NoError(t, err)
		appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 500, 900000)
		appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 500, 900000)
	}
	_, err := a.pool.Exec(t.Context(), `delete from system_setting where key='site.appearance'`)
	require.NoError(t, err)
	appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 500, 900000)
}

// TestAppearanceSameVersionHasOneWinner races two requests from one administrator
// through session middleware, asserting the committed winner and one audit.
func TestAppearanceSameVersionHasOneWinner(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0)
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, 2)
	for _, preset := range []string{"ocean", "forest"} {
		go func() {
			<-start
			body := fmt.Sprintf(`{"accentPreset":%q,"expectedUpdatedAt":%q}`, preset, current["updatedAt"])
			r := httptest.NewRequestWithContext(t.Context(), "POST", appearanceUpdatePath, strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			results <- w
		}()
	}
	close(start)
	codes := map[int]int{}
	var winner map[string]any
	for range 2 {
		w := <-results
		require.Equal(t, 200, w.Code)
		var result struct {
			Code int
			Data map[string]any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		codes[result.Code]++
		if result.Code == 0 {
			winner = result.Data
		}
	}
	require.Equal(t, map[int]int{0: 1, 900207: 1}, codes)
	require.Equal(t, winner, appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0))
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAppearanceIndependentAdminsCAS catches lost CAS across different sessions
// and an audit actor attributed to anyone other than the actual winning writer.
func TestAppearanceIndependentAdminsCAS(t *testing.T) {
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
	require.NoError(t, json.Unmarshal(domainOrderRequest(t, a, firstCookie, "POST", "/api/v1/admin/user/create", `{"username":"accent-admin","password":"second-secure-password","nickname":"Second administrator","groupKey":"admin","status":"active"}`), &created))
	secondCookie, secondActor := login("accent-admin", "second-secure-password")
	require.Equal(t, created.User.ID, secondActor.ID)
	require.NotEqual(t, firstActor.ID, secondActor.ID)
	require.NotEqual(t, firstActor.Username, secondActor.Username)
	require.False(t, firstCookie.Value == secondCookie.Value, "independent logins must have distinct sessions")
	var administrators int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where ((u.id::text=$1 and u.username=$2) or (u.id::text=$3 and u.username=$4)) and u.status='active' and u.deleted_at is null and not u.builtin and g.builtin and g.key='admin'`, firstActor.ID, firstActor.Username, secondActor.ID, secondActor.Username).Scan(&administrators))
	require.Equal(t, 2, administrators)
	current := appearanceCall(t, a, firstCookie, "GET", appearanceAdminPath, "", "", 200, 0)
	require.Equal(t, "iris", current["accentPreset"])
	require.Equal(t, current, appearanceCall(t, a, secondCookie, "GET", appearanceAdminPath, "", "", 200, 0))
	tx, err := a.pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	_, err = tx.Exec(t.Context(), `select key from system_setting where key='site.appearance' for update`)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	type outcome struct {
		actor    auth.CurrentUser
		preset   string
		response *httptest.ResponseRecorder
	}
	ready, start := make(chan struct{}, 2), make(chan struct{})
	results, finished := make(chan outcome, 2), make(chan struct{}, 2)
	for _, writer := range []struct {
		actor  auth.CurrentUser
		cookie *http.Cookie
		preset string
	}{{firstActor, firstCookie, "ocean"}, {secondActor, secondCookie, "forest"}} {
		go func() {
			defer func() { finished <- struct{}{} }()
			ready <- struct{}{}
			<-start
			r := httptest.NewRequestWithContext(ctx, "POST", appearanceUpdatePath, strings.NewReader(fmt.Sprintf(`{"accentPreset":%q,"expectedUpdatedAt":%q}`, writer.preset, current["updatedAt"])))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(writer.cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			results <- outcome{writer.actor, writer.preset, w}
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
		err := a.pool.QueryRow(ctx, `with recursive waiting(pid) as (select pid from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)) union select a.pid from pg_stat_activity a join waiting w on w.pid=any(pg_blocking_pids(a.pid))) select count(*) from waiting`, tx.Conn().PgConn().PID()).Scan(&waiting)
		return err == nil && waiting == 2
	}, 2*time.Second, 5*time.Millisecond, "both independent writers must queue behind the real setting lock")
	require.NoError(t, tx.Commit(ctx))
	codes := map[int]int{}
	var winner map[string]any
	var winnerID string
	for range 2 {
		var result outcome
		select {
		case result = <-results:
		case <-ctx.Done():
			t.Fatal("independent appearance result timed out")
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
			require.Equal(t, result.preset, body.Data["accentPreset"])
			winner, winnerID = body.Data, result.actor.ID
		}
	}
	require.Equal(t, map[int]int{0: 1, 900207: 1}, codes)
	previous, err := time.Parse(time.RFC3339Nano, current["updatedAt"].(string))
	require.NoError(t, err)
	next, err := time.Parse(time.RFC3339Nano, winner["updatedAt"].(string))
	require.NoError(t, err)
	require.True(t, next.After(previous))
	for _, cookie := range []*http.Cookie{firstCookie, secondCookie} {
		require.Equal(t, winner, appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0))
	}
	require.Equal(t, map[string]any{"accentPreset": winner["accentPreset"]}, appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 200, 0))
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
	require.Equal(t, 1, count)
	var audit string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log where resource_id='site.appearance'`).Scan(&audit))
	require.JSONEq(t, fmt.Sprintf(`{"actor":%q,"resource":"system_setting","id":"site.appearance","action":"settings_change","fields":["site.appearance"]}`, winnerID), audit)
}

// TestAppearanceQueuedRevocation observes a writer blocked on a real revocation
// transaction, then proves that the old cookie cannot bypass current authority.
func TestAppearanceQueuedRevocation(t *testing.T) {
	for _, revoke := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where username='admin'`},
		{"deleted", `update app_user set deleted_at=now() where username='admin'`},
		{"membership", `update app_user set group_id=(select id from user_group where key='user') where username='admin'`},
		{"admin access", `update user_group set permissions='["system:manage"]' where key='admin'`},
		{"system manage", `update user_group set permissions='["admin:access"]' where key='admin'`},
	} {
		t.Run(revoke.name, func(t *testing.T) {
			a := newTestApplication(t)
			cookie := domainOrderLogin(t, a)
			current := appearanceCall(t, a, cookie, "GET", appearanceAdminPath, "", "", 200, 0)
			tx, err := a.pool.Begin(t.Context())
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, tx.Rollback) }()
			_, err = tx.Exec(t.Context(), revoke.sql)
			require.NoError(t, err)
			result := make(chan *httptest.ResponseRecorder, 1)
			go func() {
				body := fmt.Sprintf(`{"accentPreset":"forest","expectedUpdatedAt":%q}`, current["updatedAt"])
				r := httptest.NewRequestWithContext(t.Context(), "POST", appearanceUpdatePath, strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				r.AddCookie(cookie)
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				result <- w
			}()
			require.Eventually(t, func() bool {
				var blocked bool
				err := a.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where $1::integer=any(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&blocked)
				return err == nil && blocked
			}, 2*time.Second, 5*time.Millisecond, "observe writer waiting, without fixed sleeps")
			require.NoError(t, tx.Commit(t.Context()))
			w := <-result
			require.Equal(t, 200, w.Code)
			var response struct{ Code int }
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
			require.Equal(t, 120001, response.Code)
			require.Equal(t, map[string]any{"accentPreset": "iris"}, appearanceCall(t, a, nil, "GET", appearancePublicPath, "", "", 200, 0))
			var count int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.appearance'`).Scan(&count))
			require.Zero(t, count)
		})
	}
}
