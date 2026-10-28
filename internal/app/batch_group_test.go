package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestAppBatchGroupChange catches a missing production command, partial group
// changes, and old sessions retaining access after a committed batch.
func TestAppBatchGroupChange(t *testing.T) {
	application := newTestApplication(t)
	manager := domainOrderLogin(t, application)
	type item struct {
		ID                string `json:"id"`
		ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
	}
	items := make([]item, 0, 2)
	oldCookies := make([]*http.Cookie, 0, 2)
	for _, username := range []string{"batch-first", "batch-second"} {
		domainOrderRequest(t, application, manager, http.MethodPost, "/api/v1/admin/user/create",
			fmt.Sprintf(`{"username":%q,"password":"secure-password","nickname":"Batch member","groupKey":"user","status":"active"}`, username))
		var id string
		var at time.Time
		require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text,updated_at from app_user where username=$1`, username).Scan(&id, &at))
		items = append(items, item{id, at.UTC().Format(time.RFC3339Nano)})
		oldCookies = append(oldCookies, batchGroupLogin(t, application, username))
	}
	body, err := json.Marshal(struct {
		Items    []item `json:"items"`
		GroupKey string `json:"groupKey"`
	}{items, "admin"})
	require.NoError(t, err)
	data := domainOrderRequest(t, application, manager, http.MethodPost, "/api/v1/admin/user/batch-change-group", string(body))
	var result struct{ ChangedCount, UnchangedCount int }
	require.NoError(t, json.Unmarshal(data, &result))
	require.Equal(t, 2, result.ChangedCount)
	require.Equal(t, 0, result.UnchangedCount)
	for i, target := range items {
		var group string
		var current time.Time
		require.NoError(t, application.pool.QueryRow(t.Context(), `select g.key,u.updated_at from app_user u join user_group g on g.id=u.group_id where u.id=$1`, target.ID).Scan(&group, &current))
		require.Equal(t, "admin", group)
		require.NotEqual(t, target.ExpectedUpdatedAt, current.UTC().Format(time.RFC3339Nano))
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user/list", nil)
		r.AddCookie(oldCookies[i])
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var denied struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &denied))
		require.Equal(t, 120001, denied.Code, "old cookie must not keep administrative access")
	}
	for _, username := range []string{"batch-first", "batch-second"} {
		cookie := batchGroupLogin(t, application, username)
		// A fresh login must resolve the new database group and its permissions.
		domainOrderRequest(t, application, cookie, http.MethodGet, "/api/v1/admin/user/list", "")
	}
	var audits int
	require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_type='user' and resource_id=any($1::text[]) and action='update' and changed_fields=array['group_id']`, []string{items[0].ID, items[1].ID}).Scan(&audits))
	require.Equal(t, 2, audits)
}

// batchGroupLogin obtains a real production Cookie for an isolated local account.
func batchGroupLogin(t *testing.T, application *App, username string) *http.Cookie {
	t.Helper()
	r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":"secure-password"}`, username)))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(w, r)
	require.Equal(t, http.StatusOK, w.Code)
	var response struct{ Code int }
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	require.Zero(t, response.Code)
	for _, cookie := range w.Result().Cookies() {
		if cookie.Name == "moeurl_session" {
			return cookie
		}
	}
	t.Fatal("login did not return a session cookie")
	return nil
}
