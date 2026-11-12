package http_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/createquota"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestOwnDailyCreateUsageRouter exercises production registration, real
// sessions, current DB authorization and private strict framing together.
func TestOwnDailyCreateUsageRouter(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const first = "00000000-0000-0000-0000-000000006501"
	const second = "00000000-0000-0000-0000-000000006502"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000006510','user','User','["short_link:create"]',true,now(),now()); insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000006501','usage-first','First','00000000-0000-0000-0000-000000006510','active',false,now(),now()),('00000000-0000-0000-0000-000000006502','usage-second','Second','00000000-0000-0000-0000-000000006510','active',false,now(),now()); insert into account_daily_create_usage values('00000000-0000-0000-0000-000000006501',(clock_timestamp() at time zone 'UTC')::date,3),('00000000-0000-0000-0000-000000006502',(clock_timestamp() at time zone 'UTC')::date,17)`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	one, err := sessions.Create(t.Context(), first)
	require.NoError(t, err)
	two, err := sessions.Create(t.Context(), second)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), OwnDailyCreateUsage: createquota.NewService(pool)})
	call := func(path, token string, header []string, status, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "GET", "/api/v1/account/daily-create-usage"+path, nil)
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		if header != nil {
			r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")] = header
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, status, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var value struct {
			Code int
			Data map[string]any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &value))
		require.Equal(t, code, value.Code, w.Body.String())
		if code != 0 {
			require.Nil(t, value.Data)
		}
		return value.Data
	}
	require.Equal(t, "3", call("", one.ID, []string{first}, 200, 0)["used"])
	require.Equal(t, "17", call("", two.ID, []string{second}, 200, 0)["used"])
	call("", two.ID, []string{first}, 200, 120001)
	call("", one.ID, []string{first, first}, 200, 120001)
	call("", one.ID, []string{""}, 200, 120001)
	call("", "", nil, 200, 120001)
	call("?", one.ID, nil, 200, 100001)
	call("?actorId="+second, one.ID, nil, 200, 100001)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where key='user'`)
	require.NoError(t, err)
	call("", one.ID, nil, 200, 120001)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["short_link:create"]' where key='user';update account_daily_create_usage set usage_day=(clock_timestamp() at time zone 'UTC')::date+1`)
	require.NoError(t, err)
	call("", one.ID, nil, 500, 900000)
}
