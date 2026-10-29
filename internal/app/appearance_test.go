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

// TestAppearanceSameVersionHasOneWinner races two actual administrators through
// the session middleware, asserting the committed winner and exactly one audit.
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
			defer func() { _ = tx.Rollback(context.Background()) }()
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
