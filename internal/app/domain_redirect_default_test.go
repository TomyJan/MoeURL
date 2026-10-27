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

// TestAppDomainRedirectDefaultsContract catches missing production endpoints,
// defaults granting mode access, and domain policy changing legacy omitted-mode creation.
func TestAppDomainRedirectDefaultsContract(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	var id string
	var revision time.Time
	require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text,updated_at from domain where is_default`).Scan(&id, &revision))
	readSetting := func() struct{ DomainID, RedirectMode, UpdatedAt string } {
		raw := domainOrderRequest(t, application, cookie, http.MethodGet, "/api/v1/admin/domain/redirect-default?id="+id, "")
		var result struct {
			Setting struct{ DomainID, RedirectMode, UpdatedAt string }
		}
		require.NoError(t, json.Unmarshal(raw, &result))
		return result.Setting
	}
	setting := readSetting()
	require.Equal(t, id, setting.DomainID)
	require.Equal(t, "direct", setting.RedirectMode)
	require.Equal(t, revision.UTC().Format(time.RFC3339Nano), setting.UpdatedAt)
	explicit := domainOrderRequest(t, application, cookie, http.MethodPost, "/api/v1/short-link/create", `{"targetUrl":"https://example.com/earlier-confirmation","redirectMode":"confirmation"}`)
	var earlier struct {
		ShortLink struct{ ID, RedirectMode string }
	}
	require.NoError(t, json.Unmarshal(explicit, &earlier))
	require.Equal(t, "confirmation", earlier.ShortLink.RedirectMode)
	raw := domainOrderRequest(t, application, cookie, http.MethodPost, "/api/v1/admin/domain/set-redirect-default",
		fmt.Sprintf(`{"id":%q,"redirectMode":"confirmation","expectedUpdatedAt":%q}`, id, setting.UpdatedAt))
	var saved struct {
		Setting struct{ DomainID, RedirectMode, UpdatedAt string }
	}
	require.NoError(t, json.Unmarshal(raw, &saved))
	require.Equal(t, id, saved.Setting.DomainID)
	require.Equal(t, "confirmation", saved.Setting.RedirectMode)
	require.NotEqual(t, setting.UpdatedAt, saved.Setting.UpdatedAt)
	setting = readSetting()
	require.Equal(t, saved.Setting, setting)
	readEffective := func() string {
		data := domainOrderRequest(t, application, cookie, http.MethodGet, "/api/v1/domain/redirect-defaults", "")
		var result struct {
			Items []struct{ DomainID, RedirectMode string }
		}
		require.NoError(t, json.Unmarshal(data, &result))
		require.Len(t, result.Items, 1)
		require.Equal(t, id, result.Items[0].DomainID)
		return result.Items[0].RedirectMode
	}
	require.Equal(t, "confirmation", readEffective())
	legacy := domainOrderRequest(t, application, cookie, http.MethodPost, "/api/v1/short-link/create", `{"targetUrl":"https://example.com/legacy-default"}`)
	var created struct{ ShortLink struct{ RedirectMode string } }
	require.NoError(t, json.Unmarshal(legacy, &created))
	require.Equal(t, "direct", created.ShortLink.RedirectMode, "old clients omit mode to request direct, not domain policy")
	_, err := application.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:use_confirmation' where key='admin'`)
	require.NoError(t, err)
	require.Equal(t, "direct", readEffective(), "configured confirmation must not grant use permission")
	require.Equal(t, "confirmation", readSetting().RedirectMode, "effective fallback must not erase saved configuration")
	domainOrderRequest(t, application, cookie, http.MethodPost, "/api/v1/admin/domain/set-redirect-default",
		fmt.Sprintf(`{"id":%q,"redirectMode":"direct","expectedUpdatedAt":%q}`, id, saved.Setting.UpdatedAt))
	require.Equal(t, "direct", readSetting().RedirectMode)
	var originalMode string
	require.NoError(t, application.pool.QueryRow(t.Context(), `select redirect_mode from short_link where id=$1`, earlier.ShortLink.ID).Scan(&originalMode))
	require.Equal(t, "confirmation", originalMode, "changing domain defaults must not rewrite an earlier explicit link")
	for _, path := range []string{"/api/v1/admin/domain/list", "/api/v1/domain/available"} {
		data := domainOrderRequest(t, application, cookie, http.MethodGet, path, "")
		var result struct{ Items []map[string]json.RawMessage }
		require.NoError(t, json.Unmarshal(data, &result))
		require.Len(t, result.Items, 1)
		require.NotContains(t, result.Items[0], "defaultRedirectMode", "legacy strict DTO must not widen")
		require.NotContains(t, result.Items[0], "redirectMode", "only new projection exposes mode")
	}
}

// TestAppDomainRedirectDefaultStrictContract catches malformed commands reaching
// storage and authorization or conflict errors being replaced by generic success.
func TestAppDomainRedirectDefaultStrictContract(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	var id string
	var revision time.Time
	require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text,updated_at from domain where is_default`).Scan(&id, &revision))
	valid := fmt.Sprintf(`{"id":%q,"redirectMode":"confirmation","expectedUpdatedAt":%q}`, id, revision.UTC().Format(time.RFC3339Nano))
	request := func(method, path, body, media string, authenticated bool, code int) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		if media != "" {
			r.Header.Set("Content-Type", media)
		}
		if authenticated {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, code, result.Code, "%s %s: %s", method, path, w.Body.String())
	}
	request("GET", "/api/v1/admin/domain/redirect-default?id="+id, "", "", false, 120001)
	request("GET", "/api/v1/domain/redirect-defaults", "", "", false, 120001)
	request("GET", "/api/v1/admin/domain/redirect-default?id=00000000-0000-0000-0000-000000009999", "", "", true, 210102)
	for _, query := range []string{"", "?id=", "?id=" + id + "&id=" + id, "?id=" + id + "&extra=1", "?id=00000000-0000-0000-0000-000000000000", "?id=broken"} {
		request("GET", "/api/v1/admin/domain/redirect-default"+query, "", "", true, 100001)
	}
	request("GET", "/api/v1/domain/redirect-defaults?groupKey=admin", "", "", true, 100001)
	for _, test := range []struct{ name, body, media string }{
		{"media absent", valid, ""}, {"wrong media", valid, "text/plain"},
		{"broken media", valid, "application/json; broken"},
		{"null", "null", "application/json"}, {"array", "[]", "application/json"},
		{"truncated", "{", "application/json"}, {"missing", `{}`, "application/json"},
		{"invalid second key", `{"id":"x",1:1}`, "application/json"},
		{"unknown", strings.TrimSuffix(valid, "}") + `,"extra":true}`, "application/json"},
		{"duplicate", strings.TrimSuffix(valid, "}") + `,"redirectMode":"direct"}`, "application/json"},
		{"trailing", valid + " {}", "application/json"}, {"junk", valid + " junk", "application/json"},
		{"null mode", strings.Replace(valid, `"confirmation"`, "null", 1), "application/json"},
		{"wrong mode", strings.Replace(valid, `"confirmation"`, `"Confirmation"`, 1), "application/json"},
		{"invalid version", strings.Replace(valid, revision.UTC().Format(time.RFC3339Nano), "yesterday", 1), "application/json"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request("POST", "/api/v1/admin/domain/set-redirect-default", test.body, test.media, true, 100001)
			var mode string
			var current time.Time
			require.NoError(t, application.pool.QueryRow(t.Context(), `select default_redirect_mode,updated_at from domain where id=$1`, id).Scan(&mode, &current))
			require.Equal(t, "direct", mode)
			require.True(t, revision.Equal(current), "rejected commands must not advance revision")
		})
	}
	request("POST", "/api/v1/admin/domain/set-redirect-default", valid, "application/json; charset=utf-8", true, 0)
	request("POST", "/api/v1/admin/domain/set-redirect-default", valid, "application/json", true, 210103)
}
