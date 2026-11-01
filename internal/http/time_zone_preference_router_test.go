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
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// TestRouterTimeZonePreferenceSessionBoundary verifies actual cookie identity and production routes.
func TestRouterTimeZonePreferenceSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000003621','user','User','[]',true,now(),now());insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000003611','zone-user','User','00000000-0000-0000-0000-000000003621','active',false,now(),now()),('00000000-0000-0000-0000-000000003612','zone-other','Other','00000000-0000-0000-0000-000000003621','active',false,now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	actor, err := sessions.Create(t.Context(), "00000000-0000-0000-0000-000000003611")
	require.NoError(t, err)
	other, err := sessions.Create(t.Context(), "00000000-0000-0000-0000-000000003612")
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), UserTimeZonePreference: user.NewTimeZonePreferenceService(pool)})
	call := func(method, token, body string, code int) map[string]any {
		t.Helper()
		path := "/api/v1/user/time-zone-preference"
		if method == http.MethodPost {
			path += "/update"
		}
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var result struct {
			Code int            `json:"code"`
			Data map[string]any `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, code, result.Code, w.Body.String())
		if code == 0 {
			require.Len(t, result.Data, 1)
			p, ok := result.Data["preference"].(map[string]any)
			require.True(t, ok)
			require.Len(t, p, 2)
			return p
		}
		return nil
	}
	call(http.MethodGet, "", "", 120001)
	call(http.MethodPost, "", `{"timeZone":null,"expectedUpdatedAt":null}`, 120001)
	unset := call(http.MethodGet, actor.ID, "", 0)
	require.Nil(t, unset["timeZone"])
	require.Nil(t, unset["updatedAt"])
	saved := call(http.MethodPost, actor.ID, `{"timeZone":"Asia/Tokyo","expectedUpdatedAt":null}`, 0)
	require.Equal(t, "Asia/Tokyo", saved["timeZone"])
	require.NotEmpty(t, saved["updatedAt"])
	require.Equal(t, saved, call(http.MethodGet, actor.ID, "", 0))
	isolated := call(http.MethodGet, other.ID, "", 0)
	require.Nil(t, isolated["timeZone"])
	require.Nil(t, isolated["updatedAt"])
	call(http.MethodPost, other.ID, fmt.Sprintf(`{"timeZone":"UTC","expectedUpdatedAt":%q}`, saved["updatedAt"]), 300104)
	call(http.MethodPost, actor.ID, `{"timeZone":"UTC","expectedUpdatedAt":null}`, 300104)
	cleared := call(http.MethodPost, actor.ID, fmt.Sprintf(`{"timeZone":null,"expectedUpdatedAt":%q}`, saved["updatedAt"]), 0)
	require.Nil(t, cleared["timeZone"])
	require.NotEqual(t, saved["updatedAt"], cleared["updatedAt"])
}
