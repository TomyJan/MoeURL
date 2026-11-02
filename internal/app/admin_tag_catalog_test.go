package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAdminTagCatalogHTTP catches missing production wiring, cross-owner undercounting, and expansion of the personal endpoint.
func TestAdminTagCatalogHTTP(t *testing.T) {
	application := newTestApplication(t)
	manager := domainOrderLogin(t, application)
	for _, username := range []string{"catalog-first", "catalog-second"} {
		domainOrderRequest(t, application, manager, http.MethodPost, "/api/v1/admin/user/create",
			`{"username":"`+username+`","password":"secure-password","nickname":"Catalog member","groupKey":"user","status":"active"}`)
		_, err := application.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,tags,created_at,updated_at)
			select gen_random_uuid(),u.id,d.id,$1,'https://example.com/private','active',array['Shared',$1],now(),now()
			from app_user u cross join domain d where u.username=$1 and d.is_default`, username)
		require.NoError(t, err)
	}
	read := func(path string, cookie *http.Cookie) (int, []map[string]any, bool) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		if cookie != nil {
			r.AddCookie(cookie)
		}
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Contains(t, w.Header().Get("Cache-Control"), "no-store")
		var body struct {
			Code int `json:"code"`
			Data struct {
				Items   []map[string]any `json:"items"`
				HasMore bool             `json:"hasMore"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		return body.Code, body.Data.Items, body.Data.HasMore
	}
	code, items, more := read("/api/v1/admin/short-link/tags", manager)
	require.Zero(t, code, "management directory must be a real production endpoint")
	require.Equal(t, []map[string]any{
		{"tag": "Shared", "linkCount": float64(2)},
		{"tag": "catalog-first", "linkCount": float64(1)},
		{"tag": "catalog-second", "linkCount": float64(1)},
	}, items)
	require.False(t, more)
	code, items, more = read("/api/v1/short-link/tags", manager)
	require.Zero(t, code)
	require.NotNil(t, items)
	require.Empty(t, items, "administrator personal directory must stay personal")
	require.False(t, more)
	code, _, _ = read("/api/v1/admin/short-link/tags", nil)
	require.Equal(t, 120001, code)
	code, _, _ = read("/api/v1/admin/short-link/tags", batchGroupLogin(t, application, "catalog-first"))
	require.Equal(t, 120001, code)
}
