package http_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestRouterSelectedListExportSessions proves both native mounts and final grants with real sessions and PostgreSQL.
func TestRouterSelectedListExportSessions(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const adminID = "00000000-0000-0000-0000-00000000e611"
	const userID = "00000000-0000-0000-0000-00000000e612"
	const linkID = "00000000-0000-0000-0000-00000000e613"
	adminPermissions, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-00000000e621','admin','Admin',$1::jsonb,true,now(),now()),
		('00000000-0000-0000-0000-00000000e622','user','User','["short_link:read_own","short_link:export"]',true,now(),now())`, adminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-00000000e611','selected-admin','Admin','00000000-0000-0000-0000-00000000e621','active',false,now(),now()),
		('00000000-0000-0000-0000-00000000e612','selected-user','User','00000000-0000-0000-0000-00000000e622','active',false,now(),now());
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
		('00000000-0000-0000-0000-00000000e623','go.example.com','Selected export','short_link',true,true,now(),now());
		insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values
		('00000000-0000-0000-0000-00000000e613','00000000-0000-0000-0000-00000000e612','00000000-0000-0000-0000-00000000e623','selectedrouter','https://example.com/selected','active',now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), adminID)
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), userID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkSelectedListExport: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	call := func(path, token, body string, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var response struct {
			Code int            `json:"code"`
			Data map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, code, response.Code, "%s", w.Body.String())
		if code != 0 {
			require.Nil(t, response.Data)
		}
		return response.Data
	}
	const ownPath = "/api/v1/short-link/export/selected"
	const adminPath = "/api/v1/admin/short-link/export/selected"
	const body = `{"ids":["` + linkID + `"]}`
	for _, path := range []string{ownPath, adminPath} {
		call(path, "", body, 120001)
	}
	call(adminPath, user.ID, body, 120001)
	for _, tc := range []struct{ path, token, name string }{{ownPath, user.ID, "own"}, {adminPath, admin.ID, "all"}} {
		data := call(tc.path, tc.token, body, 0)
		require.Equal(t, "moeurl-links-"+tc.name+"-selected.csv", data["fileName"])
		require.Contains(t, data["content"], linkID)
		call(tc.path, tc.token, `{"ids":["`+linkID+`","00000000-0000-0000-0000-00000000e699"]}`, 120001)
		call(tc.path, tc.token, `{"ids":[]}`, 100001)
	}
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:export'`)
	require.NoError(t, err)
	call(ownPath, user.ID, body, 120001)
	call(adminPath, admin.ID, body, 120001)
}
