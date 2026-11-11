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

// TestRouterTargetHostDenylistSessionBoundary catches a missing registration,
// guest/user access and an audit actor not bound to the actual cookie session.
func TestRouterTargetHostDenylistSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006101','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
	('00000000-0000-4000-8000-000000006102','user','User','[]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006111','policy-admin','Admin','00000000-0000-4000-8000-000000006101','active',false,now(),now()),
	('00000000-0000-4000-8000-000000006112','policy-user','User','00000000-0000-4000-8000-000000006102','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006111")
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006112")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), TargetHostDenylist: targetpolicy.NewService(pool)})
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
	path := "/api/v1/admin/system/target-host-denylist"
	current := call("GET", path, admin.ID, "", 0)
	body := fmt.Sprintf(`{"hosts":["blocked.example"],"expectedUpdatedAt":%q}`, current["updatedAt"])
	for _, token := range []string{"", user.ID} {
		call("GET", path, token, "", 120001)
		call("POST", path+"/update", token, body, 120001)
	}
	saved := call("POST", path+"/update", admin.ID, body, 0)
	require.Equal(t, []any{"blocked.example"}, saved["hosts"])
	var actor string
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text from audit_log where resource_id='security.target_host_denylist'`).Scan(&actor))
	require.Equal(t, "00000000-0000-4000-8000-000000006111", actor)
}
