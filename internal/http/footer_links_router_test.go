package http_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// Exercise all three production routes with actual sessions and PostgreSQL,
// so route registration, no-store and the identity reaching audit are tested.
func TestRouterFooterLinksSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const adminID = "00000000-0000-0000-0000-000000003511"
	const userID = "00000000-0000-0000-0000-000000003512"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000003521','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
		('00000000-0000-0000-0000-000000003522','user','User','[]',true,now(),now());
		insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000003511','footer-admin','Admin','00000000-0000-0000-0000-000000003521','active',false,now(),now()),
		('00000000-0000-0000-0000-000000003512','footer-user','User','00000000-0000-0000-0000-000000003522','active',false,now(),now());`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), adminID)
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), userID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), FooterLinks: system.NewFooterLinksService(pool)})
	call := func(method, path, token, body string, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, "%s", w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct {
			Code int            `json:"code"`
			Data map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, code, result.Code, "%s", w.Body.String())
		return result.Data
	}
	const publicPath = "/api/v1/system/footer-links"
	const adminPath = "/api/v1/admin/system/footer-links"
	public := call("GET", publicPath, "", "", 0)
	require.Equal(t, map[string]any{"links": []any{}}, public)
	current := call("GET", adminPath, admin.ID, "", 0)
	require.Len(t, current, 2)
	body := fmt.Sprintf(`{"links":[{"label":"<b>Docs</b>","url":"https://docs.example/a/../b?A=b#FAQ"}],"expectedUpdatedAt":%q}`, current["updatedAt"])
	for _, token := range []string{"", user.ID} {
		call("GET", adminPath, token, "", 120001)
		call("POST", adminPath+"/update", token, body, 120001)
	}
	saved := call("POST", adminPath+"/update", admin.ID, body, 0)
	require.NotEqual(t, current["updatedAt"], saved["updatedAt"])
	call("POST", adminPath+"/update", admin.ID, body, 900209)
	public = call("GET", publicPath, "", "", 0)
	require.Equal(t, map[string]any{"links": []any{map[string]any{"label": "<b>Docs</b>", "url": "https://docs.example/a/../b?A=b#FAQ"}}}, public)
	require.NotContains(t, public, "updatedAt")
	require.Equal(t, saved, call("GET", adminPath, admin.ID, "", 0))
	var actor string
	var count int
	var fields []string
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='site.footer_links'`).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text,changed_fields from audit_log where resource_id='site.footer_links'`).Scan(&actor, &fields))
	require.Equal(t, adminID, actor)
	require.Equal(t, []string{"site.footer_links"}, fields)
}
