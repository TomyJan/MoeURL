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
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestRouterTargetIPDenylistSessionBoundary catches absent production routes,
// trusting stale session grants and misattributing the key-only audit actor.
func TestRouterTargetIPDenylistSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006901','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
	('00000000-0000-4000-8000-000000006902','user','User','[]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006911','ip-admin','Admin','00000000-0000-4000-8000-000000006901','active',false,now(),now()),
	('00000000-0000-4000-8000-000000006912','ip-user','User','00000000-0000-4000-8000-000000006902','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006911")
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006912")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), TargetIPDenylist: targetpolicy.NewIPService(pool)})
	call := func(method, path, token, body string, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct {
			Code int
			Data map[string]any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, code, result.Code, w.Body.String())
		return result.Data
	}
	path := "/api/v1/admin/system/target-ip-denylist"
	current := call("GET", path, admin.ID, "", 0)
	body := fmt.Sprintf(`{"addresses":["::ffff:203.0.113.9"],"expectedUpdatedAt":%q}`, current["updatedAt"])
	for _, token := range []string{"", user.ID} {
		call("GET", path, token, "", 120001)
		call("POST", path+"/update", token, body, 120001)
	}
	saved := call("POST", path+"/update", admin.ID, body, 0)
	require.Equal(t, []any{"203.0.113.9"}, saved["addresses"])
	call("POST", path+"/update", admin.ID, body, 900221)
	var actor string
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text from audit_log where resource_id='security.target_ip_denylist'`).Scan(&actor))
	require.Equal(t, "00000000-0000-4000-8000-000000006911", actor)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call("GET", path, admin.ID, "", 120001)
	call("POST", path+"/update", admin.ID, body, 120001)
}
