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

// TestRouterShortLinkNoteSessionBoundary catches disconnected routes, wrong scope and loss of the actual audit actor.
func TestRouterShortLinkNoteSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	actor, group, domain, link := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	grants, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'admin','Admin',$2,true,now(),now())`, group, grants)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,'noteadmin','Admin',$2,'active',false,now(),now())`, actor, group)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'go.example.com','Notes','short_link',true,true,now(),now())`, domain)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values($1,$2,$3,'noterouter','https://example.com','active',now(),now())`, link, actor, domain)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkNote: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	call := func(method, path, payload, token string, want int) shortlink.NoteResult {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
			r.Header.Set("X-MoeURL-Expected-User-ID", actor)
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var response struct {
			Code int                  `json:"code"`
			Data shortlink.NoteResult `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, want, response.Code, w.Body.String())
		return response.Data
	}
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		original := call("GET", prefix+"/note?id="+link, "", session.ID, 0)
		body := fmt.Sprintf(`{"id":%q,"note":"router note","expectedUpdatedAt":%q}`, link, original.UpdatedAt)
		result := call("POST", prefix+"/note/update", body, session.ID, 0)
		require.Equal(t, "router note", result.Note)
		call("GET", prefix+"/note?id="+link, "", "", 120001)
		call("POST", prefix+"/note/update", body, "", 120001)
	}
	var actualActor string
	var fields []string
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text,changed_fields from audit_log`).Scan(&actualActor, &fields))
	require.Equal(t, actor, actualActor)
	require.Equal(t, []string{"note"}, fields)
}
