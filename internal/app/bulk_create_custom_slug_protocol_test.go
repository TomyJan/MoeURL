package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBulkCreateCustomSlugProtocol catches absent production wiring, dropped slugs and duplicate replay writes.
func TestBulkCreateCustomSlugProtocol(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111115601"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111115601","items":[{"targetUrl":"https://example.com/custom56","title":"　自定义标题　","tags":["　工具　","a,b"],"customSlug":"TeamDocs56"},{"targetUrl":"https://example.com/random56","title":"","tags":[],"customSlug":""}]}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-custom-slugs", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code)
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				RequestID    string `json:"requestId"`
				CreatedCount int    `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Zero(t, body.Code, response.Body.String())
		require.Equal(t, key, body.Data.RequestID)
		require.Equal(t, 2, body.Data.CreatedCount)
		var slug, title, actor, randomSlug string
		var tags []string
		require.NoError(t, application.pool.QueryRow(t.Context(), `select slug,title,tags,owner_id::text from short_link where target_url='https://example.com/custom56'`).Scan(&slug, &title, &tags, &actor))
		require.Equal(t, "teamdocs56", slug)
		require.Equal(t, "自定义标题", title)
		require.Equal(t, []string{"工具", "a,b"}, tags)
		require.NoError(t, application.pool.QueryRow(t.Context(), `select slug from short_link where target_url='https://example.com/random56'`).Scan(&randomSlug))
		require.Regexp(t, `^[a-z0-9]{6}$`, randomSlug)
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url in ('https://example.com/custom56','https://example.com/random56')),(select count(*) from audit_log where action='create' and resource_type='short_link' and actor_id=$1::uuid),(select count(*) from short_link_create_batch where request_id=$2::uuid)`, actor, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{2, 2, 1}, []int{links, audits, receipts})
	}
}
