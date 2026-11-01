package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBulkCreateProtocolCreatesOnce catches missing production wiring and duplicate writes after a lost response.
func TestBulkCreateProtocolCreatesOnce(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const requestID = "8afed221-bffc-4a61-a93e-4f8e13cdf8d1"
	const payload = `{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":["https://example.com/batch-first?q=1","https://example.org/batch-second#fragment"]}`
	for attempt := 0; attempt < 2; attempt++ {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create", strings.NewReader(payload))
		request.Header.Set("Content-Type", "application/json")
		request.AddCookie(cookie)
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusOK, response.Code, response.Body.String())
		var body struct {
			Code int `json:"code"`
			Data struct {
				RequestID    string `json:"requestId"`
				CreatedCount int    `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Zero(t, body.Code, "attempt %d: %s", attempt, response.Body.String())
		require.Equal(t, requestID, body.Data.RequestID)
		require.Equal(t, 2, body.Data.CreatedCount)
		require.Contains(t, response.Header().Get("Cache-Control"), "no-store")
		var links, audited, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from short_link where owner_id=(select id from app_user where username='admin') and target_url in ('https://example.com/batch-first?q=1','https://example.org/batch-second#fragment') and status='active' and redirect_mode='direct' and intermediate_delay_seconds=5 and expires_at is null and password_hash is null and max_visits is null and title='' and cardinality(tags)=0`).Scan(&links))
		require.Equal(t, 2, links, "all batch rows must persist exactly once with documented defaults")
		require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_type='short_link' and action='create' and actor_id=(select id from app_user where username='admin')`).Scan(&audited))
		require.Equal(t, 2, audited, "replay must not add audit entries")
		require.NoError(t, application.pool.QueryRow(t.Context(), `select count(*) from short_link_create_batch where request_id=$1 and created_count=2`, requestID).Scan(&receipts))
		require.Equal(t, 1, receipts)
	}
}
