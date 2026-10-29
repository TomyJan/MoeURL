package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

const homeContentAdminPath = "/api/v1/admin/system/home-content"
const homeContentUpdatePath = homeContentAdminPath + "/update"

// homeContentCall exercises real production wiring, JSON decoding, identity,
// persistence and public projection, rather than a fake port's call counts.
func homeContentCall(t *testing.T, a *App, cookie *http.Cookie, method, path, body string, status, code int) map[string]any {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(w, r)
	require.Equal(t, status, w.Code, "%s %s: %s", method, path, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var result struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, code, result.Code, "%s", w.Body.String())
	if status == http.StatusInternalServerError {
		require.NotContains(t, w.Body.String(), "site.home_content")
		require.NotContains(t, w.Body.String(), "editorial")
	}
	return result.Data
}

// TestAppHomeContentPublicAndCAS catches missing production endpoints, widening
// legacy DTOs, lost updates, false no-ops and accidental cross-resource writes.
func TestAppHomeContentPublicAndCAS(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	public := homeContentCall(t, a, nil, "GET", "/api/v1/system/home-content", "", 200, 0)
	require.Equal(t, map[string]any{"title": "", "summary": ""}, public)
	current := homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 200, 0)
	require.Len(t, current, 3)
	version, ok := current["updatedAt"].(string)
	require.True(t, ok)
	_, err := time.Parse(time.RFC3339Nano, version)
	require.NoError(t, err)
	var legacyBefore string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.home_content'`).Scan(&legacyBefore))
	body := fmt.Sprintf(`{"title":"  Our links  ","summary":"<b>{name}</b> 🌲","expectedUpdatedAt":%q}`, version)
	saved := homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, body, 200, 0)
	require.Equal(t, "Our links", saved["title"])
	require.Equal(t, "<b>{name}</b> 🌲", saved["summary"])
	require.NotEqual(t, version, saved["updatedAt"])
	public = homeContentCall(t, a, nil, "GET", "/api/v1/system/home-content", "", 200, 0)
	require.Equal(t, map[string]any{"title": "Our links", "summary": "<b>{name}</b> 🌲"}, public)
	var legacyAfter string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.home_content'`).Scan(&legacyAfter))
	require.Equal(t, legacyBefore, legacyAfter)
	body = fmt.Sprintf(`{"title":"Our links","summary":"<b>{name}</b> 🌲","expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, body, 200, 0), "a fresh no-op keeps the exact revision")
	body = fmt.Sprintf(`{"title":"Our links","summary":"<b>{name}</b> 🌲","expectedUpdatedAt":%q}`, version)
	homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, body, 200, 900205)
	var history int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.home_content'`).Scan(&history))
	require.Equal(t, 1, history)
	old := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/settings", "", 200, 0)
	require.NotContains(t, old, "title")
	require.NotContains(t, old, "summary")
	old["expectedUpdatedAt"] = old["updatedAt"]
	delete(old, "updatedAt")
	old["siteName"] = "Legacy general save"
	encoded, err := json.Marshal(old)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/admin/system/settings/update", string(encoded), 200, 0)
	require.Equal(t, saved, homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 200, 0))
	legacyPublic := homeContentCall(t, a, nil, "GET", "/api/v1/system/public-config", "", 200, 0)
	require.Len(t, legacyPublic, 5, "the old strict public DTO must not widen")
	require.Equal(t, "Legacy general save", legacyPublic["siteName"])
}

// TestAppHomeContentStrictUnicodeContract catches malformed commands and UTF16
// length limits rejecting valid emoji while accepting overlong stored text.
func TestAppHomeContentStrictUnicodeContract(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var revision time.Time
	require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at from system_setting where key='site.home_content'`).Scan(&revision))
	version := revision.UTC().Format(time.RFC3339Nano)
	valid := fmt.Sprintf(`{"title":"T","summary":"S","expectedUpdatedAt":%q}`, version)
	for _, tc := range []struct{ name, body string }{
		{"empty", ""}, {"null object", "null"}, {"array", "[]"},
		{"missing title", fmt.Sprintf(`{"summary":"S","expectedUpdatedAt":%q}`, version)},
		{"missing summary", fmt.Sprintf(`{"title":"T","expectedUpdatedAt":%q}`, version)},
		{"missing version", `{"title":"T","summary":"S"}`},
		{"null title", strings.Replace(valid, `"T"`, "null", 1)},
		{"null summary", strings.Replace(valid, `"S"`, "null", 1)},
		{"null version", `{"title":"T","summary":"S","expectedUpdatedAt":null}`},
		{"wrong type", strings.Replace(valid, `"T"`, "4", 1)},
		{"unknown", strings.Replace(valid, `"title"`, `"extra":true,"title"`, 1)},
		{"trailing", valid + " {}"}, {"junk", valid + " x"},
		{"invalid utf8", strings.Replace(valid, "T", string([]byte{0xff}), 1)},
		{"oversize body", valid + strings.Repeat(" ", 8192)},
		{"81 title", fmt.Sprintf(`{"title":%q,"summary":"","expectedUpdatedAt":%q}`, strings.Repeat("🌲", 81), version)},
		{"201 summary", fmt.Sprintf(`{"title":"","summary":%q,"expectedUpdatedAt":%q}`, strings.Repeat("界", 201), version)},
		{"leading newline", strings.Replace(valid, `"T"`, `"\nT"`, 1)},
		{"tab", strings.Replace(valid, `"S"`, `"S\t"`, 1)},
		{"nul", strings.Replace(valid, `"T"`, `"\u0000"`, 1)},
		{"bad version", strings.Replace(valid, version, "yesterday", 1)},
		{"zero version", strings.Replace(valid, version, "0001-01-01T00:00:00Z", 1)},
		{"no timezone", strings.Replace(valid, version, "2026-10-29T01:02:03", 1)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, tc.body, 200, 900204)
		})
	}
	var after time.Time
	require.NoError(t, a.pool.QueryRow(t.Context(), `select updated_at from system_setting where key='site.home_content'`).Scan(&after))
	require.True(t, after.Equal(revision), "rejected commands must not write")
	title, summary := strings.Repeat("🌲", 80), strings.Repeat("界", 200)
	body := fmt.Sprintf(`{"title":%q,"summary":%q,"expectedUpdatedAt":%q}`, "\u00a0"+title+"\u3000", summary, version)
	saved := homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, body, 200, 0)
	require.Equal(t, title, saved["title"])
	require.Equal(t, summary, saved["summary"])
}

// TestAppHomeContentCurrentPermissions catches granting access from an old
// session, missing one permission, or confusing public read with management.
func TestAppHomeContentCurrentPermissions(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, path := range []string{homeContentAdminPath, homeContentUpdatePath} {
		method, body := "GET", ""
		if path == homeContentUpdatePath {
			method, body = "POST", `{"title":"","summary":"","expectedUpdatedAt":"2026-10-29T00:00:00Z"}`
		}
		homeContentCall(t, a, nil, method, path, body, 200, 120001)
	}
	for _, permissions := range []string{`[]`, `["admin:access"]`, `["system:manage"]`} {
		_, err := a.pool.Exec(t.Context(), `update user_group set permissions=$1 where key='admin'`, permissions)
		require.NoError(t, err)
		homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 200, 120001)
		homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, `{"title":"","summary":"","expectedUpdatedAt":"2026-10-29T00:00:00Z"}`, 200, 120001)
	}
	homeContentCall(t, a, nil, "GET", "/api/v1/system/home-content", "", 200, 0)
}

// TestAppHomeContentAuditFailureRollsBack catches a successful content write
// with a failed audit insert and public errors leaking persisted copy.
func TestAppHomeContentAuditFailureRollsBack(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 200, 0)
	_, err := a.pool.Exec(t.Context(), `create function fail_home_audit() returns trigger language plpgsql as $$ begin raise exception 'editorial audit unavailable'; end $$; create trigger fail_home_audit before insert on audit_log for each row execute function fail_home_audit()`)
	require.NoError(t, err)
	body := fmt.Sprintf(`{"title":"editorial","summary":"uncommitted","expectedUpdatedAt":%q}`, current["updatedAt"])
	homeContentCall(t, a, cookie, "POST", homeContentUpdatePath, body, 500, 900000)
	require.Equal(t, current, homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 200, 0))
}

// TestAppHomeContentCorruptStorageFailsClosed catches invented successful
// defaults when persistent content or its version cannot be trusted.
func TestAppHomeContentCorruptStorageFailsClosed(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, value := range []string{`null`, `{}`, `{"title":null,"summary":""}`, `{"title":"","summary":"","extra":true}`, `{"title":" padded ","summary":""}`, `{"title":"\n","summary":""}`} {
		_, err := a.pool.Exec(t.Context(), `update system_setting set value=$1 where key='site.home_content'`, value)
		require.NoError(t, err)
		homeContentCall(t, a, nil, "GET", "/api/v1/system/home-content", "", 500, 900000)
		homeContentCall(t, a, cookie, "GET", homeContentAdminPath, "", 500, 900000)
	}
	_, err := a.pool.Exec(t.Context(), `delete from system_setting where key='site.home_content'`)
	require.NoError(t, err)
	homeContentCall(t, a, nil, "GET", "/api/v1/system/home-content", "", 500, 900000)
}
