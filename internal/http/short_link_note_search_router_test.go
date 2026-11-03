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
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestRouterShortLinkNoteSearchSessionBoundary exercises the injected port, actual sessions and scope checks.
func TestRouterShortLinkNoteSearchSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	actor, group, domain, link := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	grants, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'admin','Admin',$2,true,now(),now())`, group, grants)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,'searchadmin','Admin',$2,'active',false,now(),now())`, actor, group)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'go.example.com','Search','short_link',true,true,now(),now())`, domain)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at) values($1,$2,$3,'searchrouter','https://example.com','active','private-search-canary',now(),now())`, link, actor, domain)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkNoteSearch: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		for _, export := range []bool{false, true} {
			for _, token := range []string{"", session.ID} {
				body := `{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"private-search-canary"}`
				path := prefix + "/note/search"
				if export {
					path += "/export"
				} else {
					body = strings.Replace(body, `{`, `{"page":1,"pageSize":20,`, 1)
				}
				r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				if token != "" {
					r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
					r.Header.Set("X-MoeURL-Expected-User-ID", actor)
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, r)
				require.Equal(t, 200, w.Code)
				require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
				var result struct {
					Code int             `json:"code"`
					Data json.RawMessage `json:"data"`
				}
				require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
				if token == "" {
					require.Equal(t, 120001, result.Code)
				} else {
					require.Zero(t, result.Code)
					require.Contains(t, string(result.Data), "searchrouter")
				}
				require.NotContains(t, w.Body.String(), "private-search-canary")
			}
		}
	}
}
