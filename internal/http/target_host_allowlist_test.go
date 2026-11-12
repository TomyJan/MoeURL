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

// TestRouterTargetHostAllowlistSessionBoundary catches missing registration,
// stale session authority, or audit identity taken from a client claim.
func TestRouterTargetHostAllowlistSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006301','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
	('00000000-0000-4000-8000-000000006302','user','User','[]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006311','allow-admin','Admin','00000000-0000-4000-8000-000000006301','active',false,now(),now()),
	('00000000-0000-4000-8000-000000006312','allow-user','User','00000000-0000-4000-8000-000000006302','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006311")
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006312")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), TargetHostAllowlist: targetpolicy.NewAllowlistService(pool)})
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
	path := "/api/v1/admin/system/target-host-allowlist"
	current := call("GET", path, admin.ID, "", 0)
	body := fmt.Sprintf(`{"enabled":true,"hosts":["allowed.example"],"expectedUpdatedAt":%q}`, current["updatedAt"])
	for _, token := range []string{"", user.ID} {
		call("GET", path, token, "", 120001)
		call("POST", path+"/update", token, body, 120001)
	}
	saved := call("POST", path+"/update", admin.ID, body, 0)
	require.Equal(t, true, saved["enabled"])
	require.Equal(t, []any{"allowed.example"}, saved["hosts"])
	call("POST", path+"/update", admin.ID, body, 900213)
	var actor string
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text from audit_log where resource_id='security.target_host_allowlist'`).Scan(&actor))
	require.Equal(t, "00000000-0000-4000-8000-000000006311", actor)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call("GET", path, admin.ID, "", 120001)
	call("POST", path+"/update", admin.ID, body, 120001)
}
