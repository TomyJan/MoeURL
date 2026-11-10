package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBulkCreateTitlesProtocolCreatesOnce catches absent production wiring and lost-response duplicates.
func TestBulkCreateTitlesProtocolCreatesOnce(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111115403"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111115403","items":[{"targetUrl":"https://example.com/titled","title":"　实际标题　"}]}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-titles", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code)
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
		require.Equal(t, 1, body.Data.CreatedCount)
		var title, actor string
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select title,owner_id::text from short_link where target_url='https://example.com/titled'`).Scan(&title, &actor))
		require.Equal(t, "实际标题", title)
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url='https://example.com/titled'),(select count(*) from audit_log where action='create' and resource_type='short_link' and actor_id=$1::uuid),(select count(*) from short_link_create_batch where request_id=$2::uuid)`, actor, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{1, 1, 1}, []int{links, audits, receipts})
	}
}
