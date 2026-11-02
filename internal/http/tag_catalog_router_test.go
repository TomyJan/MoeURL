package http_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestRouterTagCatalogSessionBoundary catches missing no-store, ambiguous input and administrator reads escaping personal ownership.
func TestRouterTagCatalogSessionBoundary(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	const userID = "00000000-0000-0000-0000-000000004111"
	const adminID = "00000000-0000-0000-0000-000000004112"
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000004121','user','User','["short_link:read_own"]',true,now(),now()),
		('00000000-0000-0000-0000-000000004122','admin','Admin','["admin:access","short_link:read_all","short_link:read_own"]',true,now(),now());
		insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000004111','tag-user','User','00000000-0000-0000-0000-000000004121','active',false,now(),now()),
		('00000000-0000-0000-0000-000000004112','tag-admin','Admin','00000000-0000-0000-0000-000000004122','active',false,now(),now());
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values('00000000-0000-0000-0000-000000004131','tags.example.com','Tags','short_link',true,true,now(),now());
		insert into short_link(id,owner_id,domain_id,slug,target_url,status,tags,created_at,updated_at) values
		(gen_random_uuid(),'00000000-0000-0000-0000-000000004111','00000000-0000-0000-0000-000000004131','usertag','https://example.com/private-user','active',array['shared','100%_'],now(),now()),
		(gen_random_uuid(),'00000000-0000-0000-0000-000000004112','00000000-0000-0000-0000-000000004131','admintag','https://example.com/private-admin','active',array['admin-only','shared'],now(),now())`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	user, err := sessions.Create(ctx, userID)
	require.NoError(t, err)
	admin, err := sessions.Create(ctx, adminID)
	require.NoError(t, err)
	resolver := auth.NewService(pool, time.Hour)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: resolver, ShortLinkTagCatalog: service})
	call := func(handler http.Handler, token, path string, status, code int) map[string]any {
		t.Helper()
		r := httptest.NewRequestWithContext(ctx, http.MethodGet, path, nil)
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		require.Equal(t, status, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body map[string]any
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, float64(code), body["code"], w.Body.String())
		if code != 0 {
			require.Nil(t, body["data"])
			return nil
		}
		return body["data"].(map[string]any)
	}
	const endpoint = "/api/v1/short-link/tags"
	userData := call(router, user.ID, endpoint, 200, 0)
	require.Equal(t, map[string]any{"items": []any{map[string]any{"tag": "100%_", "linkCount": float64(1)}, map[string]any{"tag": "shared", "linkCount": float64(1)}}, "hasMore": false}, userData)
	adminData := call(router, admin.ID, endpoint+"?q=admin", 200, 0)
	require.Equal(t, map[string]any{"items": []any{map[string]any{"tag": "admin-only", "linkCount": float64(1)}}, "hasMore": false}, adminData)
	call(router, "", endpoint, 200, 120001)
	for _, query := range []string{"q=", "q=shared", "q=%25", "q=%5F", "q=%5C", "q=%E4%B8%AD", "q=" + url.QueryEscape(strings.Repeat("界", 32))} {
		call(router, user.ID, endpoint+"?"+query, 200, 0)
	}
	for _, query := range []string{"q=a&q=b", "ownerId=" + adminID, "limit=1", "status=active", "q", "q=x&", "=x", "q=%zz", "q=x;y", "q=%FF", "q=%00", "q=%09shared", "q=shared%0A", "q=" + url.QueryEscape(strings.Repeat("界", 33))} {
		t.Run(query, func(t *testing.T) { call(router, user.ID, endpoint+"?"+query, 200, 100001) })
	}
	// The dependency's optional logger must not turn an ordinary denied request into a panic.
	direct := auth.CurrentUserMiddleware(resolver)(http.HandlerFunc(shortlink.NewTagCatalogHandler(service, nil).List))
	request := httptest.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	response := httptest.NewRecorder()
	direct.ServeHTTP(response, request)
	require.Equal(t, 200, response.Code)
	require.Contains(t, response.Body.String(), `"code":120001`)
	_, err = pool.Exec(ctx, `update user_group set permissions='["admin:access","short_link:read_all"]' where key='admin'`)
	require.NoError(t, err)
	call(router, admin.ID, endpoint, 200, 120001)
	_, err = pool.Exec(ctx, `update user_group set permissions='[]' where key='user'`)
	require.NoError(t, err)
	call(router, user.ID, endpoint, 200, 120001)
	// Keep real session resolution available while the directory's own storage fails.
	_, err = pool.Exec(ctx, `update user_group set permissions='["short_link:read_own"]' where key='user'`)
	require.NoError(t, err)
	closed, err := pgxpool.New(ctx, pool.Config().ConnString())
	require.NoError(t, err)
	closed.Close()
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	failing := apphttp.NewRouter(apphttp.Dependencies{Logger: logger, CurrentUser: resolver, ShortLinkTagCatalog: shortlink.NewService(closed, permission.NewService())})
	call(failing, user.ID, endpoint+"?q=secret-search", 500, 900000)
	require.Contains(t, logs.String(), "short_link_tag_catalog_failed")
	require.NotContains(t, logs.String(), "secret-search")
	require.NotContains(t, logs.String(), "private-user")
	require.NotContains(t, logs.String(), "closed pool")
}
