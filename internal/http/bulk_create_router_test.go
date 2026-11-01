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
	"github.com/stretchr/testify/require"
)

// TestBulkCreateRouterUsesRealSession catches missing routing and identity lost before the atomic write.
func TestBulkCreateRouterUsesRealSession(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	const actorID = "00000000-0000-0000-0000-000000003831"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003832','user','User','["short_link:create","domain:use_default"]',true,now(),now());
        insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003831','router-bulk','Bulk','00000000-0000-0000-0000-000000003832','active',false,now(),now());
        insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003833','https://router-bulk.example.com','Bulk','short_link',true,true,now(),now());
        insert into domain_user_group(domain_id,user_group_id) values
        ('00000000-0000-0000-0000-000000003833','00000000-0000-0000-0000-000000003832');`)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	session, err := sessions.Create(t.Context(), actorID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLinkBatchCreate: shortlink.NewService(pool, permission.NewDatabaseService(pool))})
	const payload = `{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":["https://example.com/router-bulk"]}`
	for _, authenticated := range []bool{false, true} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/short-link/batch-create", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		if authenticated {
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, 200, response.Code)
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				CreatedCount int `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		if authenticated {
			require.Zero(t, body.Code, response.Body.String())
			require.Equal(t, 1, body.Data.CreatedCount)
		} else {
			require.Equal(t, 120001, body.Code)
		}
	}
	var links, audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link where owner_id=$1),(select count(*) from audit_log where actor_id=$1 and resource_type='short_link' and action='create')`, actorID).Scan(&links, &audits))
	require.Equal(t, []int{1, 1}, []int{links, audits})
}
