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

// Real sessions must preserve current database authorization at the deployed
// route, including revocation while an old login cookie remains valid.
func TestRouterTargetPolicyBatchCheckSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000007201','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
	('00000000-0000-4000-8000-000000007202','user','User','[]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000007211','check-admin','Admin','00000000-0000-4000-8000-000000007201','active',false,now(),now()),
	('00000000-0000-4000-8000-000000007212','check-user','User','00000000-0000-4000-8000-000000007202','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000007211")
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000007212")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), TargetPolicyBatchCheck: shortlink.NewService(pool, permission.NewService())})
	call := func(token string, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/admin/system/target-policy/check-batch", strings.NewReader(`{"targetUrls":["https://localhost/"]}`))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var response struct {
			Code int
			Data map[string]any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, code, response.Code, w.Body.String())
		return response.Data
	}
	call("", 120001)
	call(user.ID, 120001)
	require.Equal(t, map[string]any{"items": []any{map[string]any{"index": float64(1), "outcome": "invalid_target"}}}, call(admin.ID, 0))
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call(admin.ID, 120001)
}
