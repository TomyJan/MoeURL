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
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// Real router wiring preserves cookie ownership; no unrelated capability is required.
func TestRouterListPreferenceSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000005321','user','User','[]',true,now(),now());insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000005311','list-user','User','00000000-0000-0000-0000-000000005321','active',false,now(),now())`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), "00000000-0000-0000-0000-000000005311")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), UserListPreference: user.NewListPreferenceService(pool)})
	for _, tc := range []struct {
		method, token, body string
		code                int
	}{
		{http.MethodGet, "", "", 120001},
		{http.MethodPost, "", `{"pageSize":null,"expectedUpdatedAt":null}`, 120001},
		{http.MethodGet, session.ID, "", 0},
		{http.MethodPost, session.ID, `{"pageSize":50,"expectedUpdatedAt":null}`, 0},
	} {
		path := "/api/v1/user/list-preference"
		if tc.method == http.MethodPost {
			path += "/update"
		}
		r := httptest.NewRequestWithContext(t.Context(), tc.method, path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		if tc.token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: tc.token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct {
			Code int
			Data struct{ Preference map[string]any }
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, tc.code, result.Code, w.Body.String())
		if tc.method == http.MethodPost && tc.code == 0 {
			require.Equal(t, float64(50), result.Data.Preference["pageSize"])
			require.NotEmpty(t, result.Data.Preference["updatedAt"])
		}
	}
}
