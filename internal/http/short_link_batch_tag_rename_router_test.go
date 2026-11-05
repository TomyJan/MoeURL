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
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestRouterBatchTagRenameSessionBoundary catches missing routes, stale actor binding and leaked private fields.
func TestRouterBatchTagRenameSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	actor, group, domain, link := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	grants, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'admin','Admin',$2,true,now(),now())`, group, grants)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,'renameadmin','Admin',$2,'active',false,now(),now())`, actor, group)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'go.example.com','Tags','short_link',true,true,now(),now())`, domain)
	require.NoError(t, err)
	var main time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,tags,note,created_at,updated_at) values($1,$2,$3,'renamerouter','https://example.com','active',array['old','keep'],'private-rename-note',now(),now()) returning updated_at`, link, actor, domain).Scan(&main))
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchTagRename: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	payload := func(from, to string) string {
		return fmt.Sprintf(`{"items":[{"id":%q,"expectedUpdatedAt":%q}],"fromTag":%q,"toTag":%q}`, link, main.UTC().Format(time.RFC3339Nano), from, to)
	}
	call := func(path, body, token string, header http.Header, code int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		for key, values := range header {
			r.Header[key] = values
		}
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String(), "private-rename-note")
		var result struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, code, result.Code, w.Body.String())
		return result.Data
	}
	for _, path := range []string{"/api/v1/short-link/batch-tag-rename", "/api/v1/admin/short-link/batch-tag-rename"} {
		call(path, payload("old", "new"), "", nil, 120001)
		for _, header := range []http.Header{{"X-Moeurl-Expected-User-Id": {uuid.NewString()}}, {"X-Moeurl-Expected-User-Id": {actor, actor}}, {"X-Moeurl-Expected-User-Id": {"bad"}}} {
			call(path, payload("old", "new"), session.ID, header, 120001)
		}
		before := payload("old", "new")
		require.JSONEq(t, `{"changedCount":1,"unchangedCount":0}`, string(call(path, before, session.ID, http.Header{"X-Moeurl-Expected-User-Id": {actor}}, 0)))
		call(path, before, session.ID, nil, 200116)
		var tags []string
		require.NoError(t, pool.QueryRow(t.Context(), `select tags,updated_at from short_link where id=$1`, link).Scan(&tags, &main))
		require.Equal(t, []string{"new", "keep"}, tags)
		require.JSONEq(t, `{"changedCount":0,"unchangedCount":1}`, string(call(path, payload("old", "new"), session.ID, nil, 0)))
		for _, media := range []string{"", "text/plain", "application/json; broken"} {
			call(path, payload("old", "new"), session.ID, http.Header{"Content-Type": {media}}, 100001)
		}
		call(path+"?x=1", payload("old", "new"), session.ID, nil, 100001)
		call(path, `{"items":null}`, session.ID, nil, 100001)
		_, err = pool.Exec(t.Context(), `update short_link set tags=array['old','keep'] where id=$1`, link)
		require.NoError(t, err)
	}
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and resource_id=$2 and changed_fields=array['tags']`, actor, link).Scan(&count))
	require.Equal(t, 2, count)
	grants, err = json.Marshal(permission.UserPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set key='user',permissions=$2 where id=$1`, group, grants)
	require.NoError(t, err)
	call("/api/v1/admin/short-link/batch-tag-rename", payload("old", "new"), session.ID, nil, 120001)
	require.JSONEq(t, `{"changedCount":1,"unchangedCount":0}`, string(call("/api/v1/short-link/batch-tag-rename", payload("old", "new"), session.ID, nil, 0)))
}
