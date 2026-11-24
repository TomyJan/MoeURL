package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/stretchr/testify/require"
)

// TestAppBatchUsesDatabasePermissions verifies production dependency wiring and runtime revocation in both scopes.
func TestAppBatchUsesDatabasePermissions(t *testing.T) {
	application := newTestApplication(t)
	login := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"admin","password":"secure-password"}`))
	response := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(response, login)
	require.Equal(t, http.StatusOK, response.Code)
	var cookie *http.Cookie
	for _, candidate := range response.Result().Cookies() {
		if candidate.Name == auth.SessionCookieName {
			cookie = candidate
		}
	}
	require.NotNil(t, cookie)
	var originalAdminPermissions []byte
	require.NoError(t, application.pool.QueryRow(t.Context(), `select permissions from user_group where key='admin'`).Scan(&originalAdminPermissions))
	var id string
	err := application.pool.QueryRow(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) select gen_random_uuid(),u.id,d.id,'batchapp','https://example.com','active',now(),now() from app_user u cross join domain d where u.username='admin' and d.is_default returning id::text`).Scan(&id)
	require.NoError(t, err)
	for _, path := range []string{"/api/v1/short-link/batch", "/api/v1/admin/short-link/batch"} {
		_, err = application.pool.Exec(t.Context(), `update user_group set permissions=$1::jsonb where key='admin'`, originalAdminPermissions)
		require.NoError(t, err)
		_, err = application.pool.Exec(t.Context(), `update app_user set status='active' where username='admin'`)
		require.NoError(t, err)
		for _, revoked := range []bool{false, true} {
			if revoked {
				if path == "/api/v1/admin/short-link/batch" {
					_, err = application.pool.Exec(t.Context(), `update app_user set status='disabled' where username='admin'`)
				} else {
					_, err = application.pool.Exec(t.Context(), `update user_group set permissions=permissions-$1::text where key='admin'`, permission.ShortLinkUpdateOwn)
				}
				require.NoError(t, err)
			}
			req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(fmt.Sprintf(`{"ids":[%q],"action":"disable"}`, id)))
			req.Header.Set("Content-Type", "application/json")
			req.AddCookie(cookie)
			res := httptest.NewRecorder()
			application.server.Handler.ServeHTTP(res, req)
			var body struct {
				Code int `json:"code"`
				Data struct {
					AffectedCount int `json:"affectedCount"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
			require.Equal(t, http.StatusOK, res.Code)
			require.Contains(t, res.Header().Get("Cache-Control"), "no-store")
			if revoked {
				require.Equal(t, 120001, body.Code)
			} else {
				require.Zero(t, body.Code)
				require.Equal(t, 1, body.Data.AffectedCount)
			}
		}
	}
}
