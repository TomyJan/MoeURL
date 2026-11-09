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

// TestRouterBatchNoteAppendSessionBoundary verifies real session identity, framing, private responses and replay audit counts.
func TestRouterBatchNoteAppendSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	actor, group, domain, link := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	grants, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'admin','Admin',$2,true,now(),now())`, group, grants)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,'appendrouter','Admin',$2,'active',false,now(),now())`, actor, group)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'append.example.com','Notes','short_link',true,true,now(),now())`, domain)
	require.NoError(t, err)
	var main time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at) values($1,$2,$3,'appendrouter','https://example.com','active','private-router-canary',now(),now()) returning updated_at`, link, actor, domain).Scan(&main))
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchNoteAppend: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	call := func(path, payload, token string, headers http.Header, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		for key, values := range headers {
			r.Header[key] = values
		}
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String(), "private-router-canary")
		require.NotContains(t, w.Body.String(), `"note":`)
		var response struct {
			Code int             `json:"code"`
			Data json.RawMessage `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, want, response.Code, w.Body.String())
		return response.Data
	}
	previewBody := fmt.Sprintf(`{"items":[{"id":%q,"expectedUpdatedAt":%q}],"note":"new"}`, link, main.UTC().Format(time.RFC3339Nano))
	for _, prefix := range []string{"/api/v1/short-link/note/batch-append", "/api/v1/admin/short-link/note/batch-append"} {
		var preview shortlink.BatchNoteAppendPreviewResult
		require.NoError(t, json.Unmarshal(call(prefix+"/preview", previewBody, session.ID, http.Header{"X-Moeurl-Expected-User-Id": {actor}}, 0), &preview))
		require.Len(t, preview.Items, 1)
		body, err := json.Marshal(shortlink.BatchNoteAppendInput{RequestID: uuid.NewString(), Note: "new", Items: []shortlink.BatchNoteClearItem{{ID: link, ExpectedUpdatedAt: main.UTC().Format(time.RFC3339Nano), ExpectedNoteUpdatedAt: preview.Items[0].ExpectedNoteUpdatedAt}}})
		require.NoError(t, err)
		call(prefix, string(body), session.ID, nil, 0)
		call(prefix, string(body), session.ID, nil, 0)
		call(prefix, strings.Replace(string(body), `"note":"new"`, `"note":"different"`, 1), session.ID, nil, 200120)
		for _, endpoint := range []struct{ path, body string }{{prefix + "/preview", previewBody}, {prefix, string(body)}} {
			call(endpoint.path, endpoint.body, "", nil, 120001)
			for _, header := range []http.Header{{"X-Moeurl-Expected-User-Id": {uuid.NewString()}}, {"X-Moeurl-Expected-User-Id": {actor, actor}}, {"X-Moeurl-Expected-User-Id": {"bad"}}} {
				call(endpoint.path, endpoint.body, session.ID, header, 120001)
			}
			for _, media := range []string{"", "text/plain", "application/json; broken"} {
				call(endpoint.path, endpoint.body, session.ID, http.Header{"Content-Type": {media}}, 100001)
			}
			call(endpoint.path+"?x=1", endpoint.body, session.ID, nil, 100001)
			call(endpoint.path+"?", endpoint.body, session.ID, nil, 100001)
			call(endpoint.path, `{"items":null}`, session.ID, nil, 100001)
		}
	}
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and resource_id=$2 and changed_fields=array['note']`, actor, link).Scan(&count))
	require.Equal(t, 2, count)
	grants, err = json.Marshal(permission.UserPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set key='user',permissions=$2 where id=$1`, group, grants)
	require.NoError(t, err)
	call("/api/v1/admin/short-link/note/batch-append/preview", previewBody, session.ID, nil, 120001)
}
