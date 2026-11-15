package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBulkCountdownHTTP catches a missing production endpoint and lost SQL countdown arguments.
func TestBulkCountdownHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111117701"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117701","items":[{"targetUrl":"https://example.com/countdown77-min","title":"　倒计时　","tags":["工具"],"customSlug":"Delay77Min","redirectMode":"intermediate","expiresAt":"2099-01-01T00:00:00Z","maxVisits":"1","intermediateDelaySeconds":"3"},{"targetUrl":"https://example.com/countdown77-max","title":"","tags":[],"customSlug":"","redirectMode":"intermediate","expiresAt":"","maxVisits":"","intermediateDelaySeconds":"10"},{"targetUrl":"https://example.com/countdown77-default","title":"","tags":[],"customSlug":"Delay77Default","redirectMode":"intermediate","expiresAt":"","maxVisits":"2147483647","intermediateDelaySeconds":""}]}`
	for range 2 {
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-countdowns", strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(cookie)
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		var body struct {
			Code int `json:"code"`
			Data struct {
				RequestID    string `json:"requestId"`
				CreatedCount int    `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Zero(t, body.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.Equal(t, key, body.Data.RequestID)
		require.Equal(t, 3, body.Data.CreatedCount)
		for _, expected := range []struct {
			suffix string
			delay  int16
		}{{"min", 3}, {"max", 10}, {"default", 5}} {
			var mode string
			var delay int16
			require.NoError(t, application.pool.QueryRow(t.Context(), `select redirect_mode,intermediate_delay_seconds from short_link where target_url=$1`, "https://example.com/countdown77-"+expected.suffix).Scan(&mode, &delay))
			require.Equal(t, "intermediate", mode)
			require.Equal(t, expected.delay, delay)
		}
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url like 'https://example.com/countdown77-%'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch where request_id=$1::uuid)`, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{3, 3, 1}, []int{links, audits, receipts})
	}
}

// TestBulkCountdownReplayKeepsDelayAndUsage catches writes on replay after legitimate editing and consumption.
func TestBulkCountdownReplayKeepsDelayAndUsage(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117702","items":[{"targetUrl":"https://example.com/delay77-consumed","title":"","tags":[],"customSlug":"Delay77Replay","redirectMode":"intermediate","expiresAt":"","maxVisits":"1","intermediateDelaySeconds":"3"}]}`
	post := func(path, body string) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
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
	get := func(path string) *httptest.ResponseRecorder {
		t.Helper()
		w := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(w, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "https://go.example.com"+path, nil))
		return w
	}
	post("/api/v1/short-link/batch-create-with-countdowns", payload)
	entry := get("/delay77replay")
	require.Equal(t, http.StatusFound, entry.Code)
	require.Equal(t, "/go/delay77replay", entry.Header().Get("Location"))
	preview := get("/go/delay77replay/preview")
	require.Equal(t, http.StatusOK, preview.Code)
	var body struct {
		Code int `json:"code"`
		Data struct {
			IntermediateDelaySeconds int `json:"intermediateDelaySeconds"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(preview.Body.Bytes(), &body))
	require.Zero(t, body.Code)
	require.Equal(t, 3, body.Data.IntermediateDelaySeconds)
	var used int64
	require.NoError(t, application.pool.QueryRow(t.Context(), `select visits_used from short_link where slug='delay77replay'`).Scan(&used))
	require.Zero(t, used)
	continued := get("/go/delay77replay/continue")
	require.Equal(t, http.StatusFound, continued.Code)
	require.Equal(t, "https://example.com/delay77-consumed", continued.Header().Get("Location"))
	var id string
	require.NoError(t, application.pool.QueryRow(t.Context(), `select id::text from short_link where slug='delay77replay'`).Scan(&id))
	post("/api/v1/short-link/update", fmt.Sprintf(`{"id":%q,"intermediateDelaySeconds":10}`, id))
	for range 2 {
		post("/api/v1/short-link/batch-create-with-countdowns", payload)
	}
	var delay int16
	require.NoError(t, application.pool.QueryRow(t.Context(), `select intermediate_delay_seconds,visits_used from short_link where slug='delay77replay'`).Scan(&delay, &used))
	require.Equal(t, int16(10), delay)
	require.Equal(t, int64(1), used)
	exhausted := get("/delay77replay")
	require.Equal(t, http.StatusFound, exhausted.Code)
	require.Equal(t, "/go/delay77replay?reason=exhausted", exhausted.Header().Get("Location"))
	var links, audits, receipts, events int
	require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where slug='delay77replay'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch),(select count(*) from short_link_event where event_type='redirect_response_sent')`).Scan(&links, &audits, &receipts, &events))
	require.Equal(t, []int{1, 1, 1, 1}, []int{links, audits, receipts, events})
}
