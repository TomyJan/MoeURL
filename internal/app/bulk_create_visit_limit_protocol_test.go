package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestBulkVisitLimitHTTP verifies production wiring, persisted caps and exact replay without duplicate writes.
func TestBulkVisitLimitHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111117601"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117601","items":[{"targetUrl":"https://example.com/direct76","title":"　额度　","tags":["工具"],"customSlug":"Direct76","redirectMode":"","expiresAt":"2099-01-01T00:00:00Z","maxVisits":""},{"targetUrl":"https://example.com/intermediate76","title":"","tags":[],"customSlug":"","redirectMode":"intermediate","expiresAt":"","maxVisits":"1"},{"targetUrl":"https://example.com/confirmation76","title":"","tags":[],"customSlug":"Confirm76","redirectMode":"confirmation","expiresAt":"2099-02-01T12:34:56Z","maxVisits":"2147483647"}]}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-visit-limits", strings.NewReader(payload))
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
		for _, expected := range []struct {
			target, mode string
			cap          int64
			valid        bool
		}{
			{"direct76", "direct", 0, false},
			{"intermediate76", "intermediate", 1, true},
			{"confirmation76", "confirmation", 2147483647, true},
		} {
			var mode string
			var cap pgtype.Int8
			var used int64
			require.NoError(t, application.pool.QueryRow(t.Context(), `select redirect_mode,max_visits,visits_used from short_link where target_url=$1`, "https://example.com/"+expected.target).Scan(&mode, &cap, &used))
			require.Equal(t, expected.mode, mode)
			require.Equal(t, pgtype.Int8{Int64: expected.cap, Valid: expected.valid}, cap)
			require.Zero(t, used)
		}
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url like 'https://example.com/%76'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch where request_id=$1::uuid)`, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{3, 3, 1}, []int{links, audits, receipts})
	}
}

// TestBulkVisitLimitReplayKeepsConsumedUsage follows the real public redirect and keeps exhausted links exhausted after replay.
func TestBulkVisitLimitReplayKeepsConsumedUsage(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117602","items":[{"targetUrl":"https://example.com/consumed76","title":"","tags":[],"customSlug":"Cap76Replay","redirectMode":"","expiresAt":"","maxVisits":"1"}]}`
	create := func() {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-visit-limits", strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		var result struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Zero(t, result.Code, w.Body.String())
	}
	create()
	w := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://go.example.com/cap76replay", nil))
	require.Equal(t, http.StatusFound, w.Code, w.Body.String())
	require.Equal(t, "https://example.com/consumed76", w.Header().Get("Location"))
	var used int64
	require.NoError(t, application.pool.QueryRow(t.Context(), `select visits_used from short_link where slug='cap76replay'`).Scan(&used))
	require.Equal(t, int64(1), used)
	for range 2 {
		create()
	}
	require.NoError(t, application.pool.QueryRow(t.Context(), `select visits_used from short_link where slug='cap76replay'`).Scan(&used))
	require.Equal(t, int64(1), used)
	w = httptest.NewRecorder()
	application.server.Handler.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://go.example.com/cap76replay", nil))
	require.Equal(t, http.StatusFound, w.Code)
	require.Equal(t, "/go/cap76replay?reason=exhausted", w.Header().Get("Location"))
	var links, audits, receipts, events int
	require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where slug='cap76replay'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch),(select count(*) from short_link_event where event_type='redirect_response_sent')`).Scan(&links, &audits, &receipts, &events))
	require.Equal(t, []int{1, 1, 1, 1}, []int{links, audits, receipts, events})
}
