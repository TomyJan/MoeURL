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

const footerLinksPublicPath = "/api/v1/system/footer-links"
const footerLinksAdminPath = "/api/v1/admin/system/footer-links"
const footerLinksUpdatePath = footerLinksAdminPath + "/update"

// footerLinksCall exercises real App/session/PG wiring, never a fake port.
func footerLinksCall(t *testing.T, a *App, cookie *http.Cookie, method, path, body, media string, status, code int) map[string]any {
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
	var result struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, code, result.Code, "%s", w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	if status == 500 {
		require.NotContains(t, w.Body.String(), "site.footer_links")
		require.NotContains(t, w.Body.String(), "footer audit unavailable")
		require.NotContains(t, w.Body.String(), "Secret")
		require.NotContains(t, w.Body.String(), "private.example")
		require.NotContains(t, w.Body.String(), "secret-value")
	}
	return result.Data
}

// TestFooterLinksAPI catches absent routes, widened legacy DTOs, ordering loss,
// stale no-ops, or legacy saves clearing the independent navigation list.
func TestFooterLinksAPI(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	t.Run("public_minimal_projection", func(t *testing.T) {
		require.Equal(t, map[string]any{"links": []any{}}, footerLinksCall(t, a, nil, "GET", footerLinksPublicPath, "", "", 200, 0))
	})
	t.Run("admin_ordered_CAS_audit_and_legacy_independence", func(t *testing.T) {
		current := footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0)
		require.Len(t, current, 2)
		var legacyBefore string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.footer_links'`).Scan(&legacyBefore))
		oldTime, err := time.Parse(time.RFC3339Nano, current["updatedAt"].(string))
		require.NoError(t, err)
		links := []any{
			map[string]any{"label": "Docs", "url": "https://docs.example.com/a/../b?A=b#FAQ"},
			map[string]any{"label": "<b>内网</b>", "url": "http://localhost:8080/docs"},
			map[string]any{"label": "Docs", "url": "https://docs.example.com/a/../b?A=b#FAQ"},
		}
		body := fmt.Sprintf(`{"links":[{"label":"  Docs  ","url":" HTTPS://Docs.Example.COM:00443/a/../b?A=b#FAQ "},{"label":"<b>内网</b>","url":"http://localhost:8080/docs"},{"label":"Docs","url":"https://docs.example.com/a/../b?A=b#FAQ"}],"expectedUpdatedAt":%q}`, current["updatedAt"])
		current = footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, body, "application/json", 200, 0)
		require.Len(t, current, 2)
		require.Equal(t, links, current["links"])
		nextTime, err := time.Parse(time.RFC3339Nano, current["updatedAt"].(string))
		require.NoError(t, err)
		require.True(t, nextTime.After(oldTime))
		require.Equal(t, map[string]any{"links": links}, footerLinksCall(t, a, nil, "GET", footerLinksPublicPath, "", "", 200, 0))
		footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, body, "application/json", 200, 900209)
		command, err := json.Marshal(map[string]any{"links": links, "expectedUpdatedAt": current["updatedAt"]})
		require.NoError(t, err)
		require.Equal(t, current, footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, string(command), "application/json", 200, 0))
		var legacyAfter string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'site.footer_links'`).Scan(&legacyAfter))
		require.Equal(t, legacyBefore, legacyAfter)
		var count int
		require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.footer_links'`).Scan(&count))
		require.Equal(t, 1, count)
		var actorID, audit string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actorID))
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log where resource_id='site.footer_links'`).Scan(&audit))
		require.JSONEq(t, fmt.Sprintf(`{"actor":%q,"resource":"system_setting","id":"site.footer_links","action":"settings_change","fields":["site.footer_links"]}`, actorID), audit)
		for _, path := range []string{"/api/v1/admin/system/settings", homeContentAdminPath, appearanceAdminPath} {
			old := footerLinksCall(t, a, cookie, "GET", path, "", "", 200, 0)
			require.NotContains(t, old, "links")
			old["expectedUpdatedAt"] = old["updatedAt"]
			delete(old, "updatedAt")
			switch path {
			case homeContentAdminPath:
				old["title"] = "Footer-independent homepage"
			case appearanceAdminPath:
				old["accentPreset"] = "forest"
			default:
				old["siteName"] = "Footer-independent general"
			}
			command, err := json.Marshal(old)
			require.NoError(t, err)
			footerLinksCall(t, a, cookie, "POST", path+"/update", string(command), "application/json", 200, 0)
			require.Equal(t, current, footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0))
		}
		for path, fields := range map[string]int{"/api/v1/system/public-config": 5, "/api/v1/system/home-content": 2, appearancePublicPath: 1} {
			legacy := footerLinksCall(t, a, nil, "GET", path, "", "", 200, 0)
			require.Len(t, legacy, fields)
			require.NotContains(t, legacy, "links")
		}
	})
	t.Run("guest_management_denied", func(t *testing.T) {
		footerLinksCall(t, a, nil, "GET", footerLinksAdminPath, "", "", 200, 120001)
		footerLinksCall(t, a, nil, "POST", footerLinksUpdatePath, `{"links":[],"expectedUpdatedAt":"2026-10-30T00:00:00Z"}`, "application/json", 200, 120001)
	})
}

// TestFooterLinksHTTPProtocol supplements the earlier decoder RED with real
// App/session/PG enforcement. Rejections must preserve value, version and audit.
func TestFooterLinksHTTPProtocol(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := footerLinksCall(t, a, cookie, "GET", footerLinksAdminPath, "", "", 200, 0)
	version := current["updatedAt"].(string)
	empty := fmt.Sprintf(`{"links":[],"expectedUpdatedAt":%q}`, version)
	item := `{"label":"Docs","url":"https://example.com/"}`
	command := func(links string) string { return fmt.Sprintf(`{"links":%s,"expectedUpdatedAt":%q}`, links, version) }
	snapshot := func() string {
		var value string
		require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('setting',(select to_jsonb(s) from system_setting s where key='site.footer_links'),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb) from audit_log a where resource_id='site.footer_links'))::text`).Scan(&value))
		return value
	}
	before := snapshot()
	for _, tc := range []struct {
		name, body, media string
		code              int
	}{
		{"media_missing", empty, "", 900208},
		{"media_simple_text", empty, "text/plain", 900208},
		{"media_form", empty, "application/x-www-form-urlencoded", 900208},
		{"media_multipart", empty, "multipart/form-data; boundary=x", 900208},
		{"media_invalid", empty, "application/json; invalid", 900208},
		{"media_other_json", empty, "application/problem+json", 900208},
		{"duplicate_root", fmt.Sprintf(`{"links":[],"links":[],"expectedUpdatedAt":%q}`, version), "application/json", 900208},
		{"duplicate_item", command(`[{"label":"A","label":"B","url":"https://example.com/"}]`), "application/json", 900208},
		{"wrong_case", fmt.Sprintf(`{"Links":[],"expectedUpdatedAt":%q}`, version), "application/json", 900208},
		{"null", command("null"), "application/json", 900208},
		{"unknown", fmt.Sprintf(`{"links":[],"extra":true,"expectedUpdatedAt":%q}`, version), "application/json", 900208},
		{"lone_surrogate", command(`[{"label":"\ud800","url":"https://example.com/"}]`), "application/json", 900208},
		{"invalid_utf8", command(`[{"label":"` + string([]byte{255}) + `","url":"https://example.com/"}]`), "application/json", 900208},
		{"trailing_json", empty + "{}", "application/json", 900208},
		{"body_65537", empty + strings.Repeat(" ", 65537-len(empty)), "application/json", 900208},
		{"six_items", command("[" + strings.TrimSuffix(strings.Repeat(item+",", 6), ",") + "]"), "application/json", 900208},
		{"empty_label", command(`[{"label":" ","url":"https://example.com/"}]`), "application/json", 900208},
		{"label_41", command(fmt.Sprintf(`[{"label":%q,"url":"https://example.com/"}]`, strings.Repeat("😀", 41))), "application/json", 900208},
		{"control_before_trim", command(`[{"label":"\tDocs","url":"https://example.com/"}]`), "application/json", 900208},
		{"url_2049", command(fmt.Sprintf(`[{"label":"Docs","url":%q}]`, "https://example.com/"+strings.Repeat("a", 2049-len("https://example.com/")))), "application/json", 900208},
		{"dangerous_scheme", command(`[{"label":"Docs","url":"javascript:alert(1)"}]`), "application/json", 900208},
		{"invalid_version", `{"links":[],"expectedUpdatedAt":"2026-10-30"}`, "application/json", 900208},
		{"valid_json", empty, "application/json", 0},
		{"valid_media_parameters", empty, "Application/JSON; Charset=UTF-8", 0},
		{"body_65536", empty + strings.Repeat(" ", 65536-len(empty)), "application/json", 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := footerLinksCall(t, a, cookie, "POST", footerLinksUpdatePath, tc.body, tc.media, 200, tc.code)
			if tc.code == 0 {
				require.Equal(t, current, got)
			}
			require.Equal(t, before, snapshot())
		})
	}
}
