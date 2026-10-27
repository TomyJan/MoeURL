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
	"github.com/TomyJan/MoeURL/internal/usergroup"
	"github.com/stretchr/testify/require"
)

// Catches unregistered routes, Cookie identity loss and group defaults escaping the actual DB permission boundary.
func TestRouterGroupDefaultDomainSessionBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const manager = "00000000-0000-0000-0000-000000002811"
	const member = "00000000-0000-0000-0000-000000002812"
	const selected = "00000000-0000-0000-0000-000000002813"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000002821','admin','Admin','["admin:access","domain:manage"]',true,now(),now()),
		('00000000-0000-0000-0000-000000002822','user','User','["short_link:create","domain:use_assigned"]',true,now(),now());
		insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000002811','default-manager','Manager','00000000-0000-0000-0000-000000002821','active',false,now(),now()),
		('00000000-0000-0000-0000-000000002812','default-member','Member','00000000-0000-0000-0000-000000002822','active',false,now(),now());
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values('00000000-0000-0000-0000-000000002813','https://router-group.example.com','Group','short_link',true,false,now(),now());
		insert into domain_user_group(domain_id,user_group_id)
		values('00000000-0000-0000-0000-000000002813','00000000-0000-0000-0000-000000002822');`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	adminSession, err := sessions.Create(t.Context(), manager)
	require.NoError(t, err)
	userSession, err := sessions.Create(t.Context(), member)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), UserGroupDomainDefault: usergroup.NewDomainDefaultService(pool)})
	request := func(method, path, body, token string, want int) json.RawMessage {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		if token != "" {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: token})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		var result struct {
			Code int
			Data json.RawMessage
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, want, result.Code)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		return result.Data
	}
	const readPath = "/api/v1/admin/user-group/domain-default?groupKey=user"
	request("GET", readPath, "", "", 120001)
	request("GET", readPath, "", userSession.ID, 120001)
	var read usergroup.DomainDefaultResult
	require.NoError(t, json.Unmarshal(request("GET", readPath, "", adminSession.ID, 0), &read))
	require.Equal(t, selected, read.Candidates[0].ID)
	payload := fmt.Sprintf(`{"groupKey":"user","domainId":%q,"expectedUpdatedAt":%q}`, selected, read.Setting.UpdatedAt)
	const writePath = "/api/v1/admin/user-group/set-domain-default"
	request("POST", writePath, payload, userSession.ID, 120001)
	request("POST", writePath, payload, adminSession.ID, 0)
	request("POST", writePath, payload, adminSession.ID, 300202)
	var current usergroup.CurrentDomainDefaultResult
	require.NoError(t, json.Unmarshal(request("GET", "/api/v1/domain/group-default", "", userSession.ID, 0), &current))
	require.Equal(t, "available", current.Selection.Status)
	require.NotNil(t, current.Selection.DomainID)
	require.Equal(t, selected, *current.Selection.DomainID)
	var actor string
	require.NoError(t, pool.QueryRow(t.Context(), `select actor_id::text from audit_log where resource_type='user_group' and changed_fields=array['default_domain_id']`).Scan(&actor))
	require.Equal(t, manager, actor)
}
