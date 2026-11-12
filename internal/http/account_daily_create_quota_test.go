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
	"github.com/TomyJan/MoeURL/internal/createquota"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestRouterDailyCreateQuotaSessionBoundary catches missing route wiring,
// stale session grants, and an audit actor taken from a client claim.
func TestRouterDailyCreateQuotaSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006401','admin','Admin','["admin:access","system:manage"]',true,now(),now()),
	('00000000-0000-4000-8000-000000006402','user','User','[]',true,now(),now());
	insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
	('00000000-0000-4000-8000-000000006411','quota-admin','Admin','00000000-0000-4000-8000-000000006401','active',false,now(),now()),
	('00000000-0000-4000-8000-000000006412','quota-user','User','00000000-0000-4000-8000-000000006402','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	admin, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006411")
	require.NoError(t, err)
	user, err := sessions.Create(t.Context(), "00000000-0000-4000-8000-000000006412")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), AccountDailyCreateQuota: createquota.NewService(pool)})
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
	path := "/api/v1/admin/system/account-daily-create-quota"
	current := call("GET", path, admin.ID, "", 0)
	require.Len(t, current, 2)
	require.Nil(t, current["dailyLimit"])
	body := fmt.Sprintf(`{"dailyLimit":0,"expectedUpdatedAt":%q}`, current["updatedAt"])
	for _, token := range []string{"", user.ID} {
		require.Nil(t, call("GET", path, token, "", 120001))
		require.Nil(t, call("POST", path+"/update", token, body, 120001))
	}
	saved := call("POST", path+"/update", admin.ID, body, 0)
	require.Len(t, saved, 2)
	require.Equal(t, float64(0), saved["dailyLimit"])
	require.NotEqual(t, current["updatedAt"], saved["updatedAt"])
	call("POST", path+"/update", admin.ID, body, 900215)
	var actor string
	var fields []string
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text,changed_fields from audit_log where resource_id='security.account_daily_create_quota'`).Scan(&actor, &fields))
	require.Equal(t, "00000000-0000-4000-8000-000000006411", actor)
	require.Equal(t, []string{"security.account_daily_create_quota"}, fields)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id='security.account_daily_create_quota'`).Scan(&count))
	require.Equal(t, 1, count)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	call("GET", path, admin.ID, "", 120001)
	call("POST", path+"/update", admin.ID, body, 120001)
}
