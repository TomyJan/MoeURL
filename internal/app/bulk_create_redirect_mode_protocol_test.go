package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBulkRedirectModeHTTP exercises production wiring, stored modes and atomic replay.
func TestBulkRedirectModeHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111117401"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117401","items":[{"targetUrl":"https://example.com/direct74","title":"　直接　","tags":["工具"],"customSlug":"Direct74","redirectMode":""},{"targetUrl":"https://example.com/intermediate74","title":"","tags":[],"customSlug":"","redirectMode":"intermediate"},{"targetUrl":"https://example.com/confirmation74","title":"","tags":[],"customSlug":"Confirm74","redirectMode":"confirmation"}]}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-redirect-modes", strings.NewReader(payload))
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
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		require.Equal(t, key, body.Data.RequestID)
		require.Equal(t, 3, body.Data.CreatedCount)
		for _, expected := range []struct{ target, mode string }{{"direct74", "direct"}, {"intermediate74", "intermediate"}, {"confirmation74", "confirmation"}} {
			var mode string
			var delay int
			require.NoError(t, application.pool.QueryRow(t.Context(), `select redirect_mode,intermediate_delay_seconds from short_link where target_url=$1`, "https://example.com/"+expected.target).Scan(&mode, &delay))
			require.Equal(t, expected.mode, mode)
			require.Equal(t, 5, delay)
		}
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url like 'https://example.com/%74'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch where request_id=$1::uuid)`, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{3, 3, 1}, []int{links, audits, receipts})
	}
}
