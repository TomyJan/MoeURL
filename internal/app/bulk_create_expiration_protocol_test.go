package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestBulkExpirationHTTP catches missing production wiring, lost UTC values and duplicate writes.
func TestBulkExpirationHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	const key = "11111111-1111-4111-8111-111111117501"
	const payload = `{"requestId":"11111111-1111-4111-8111-111111117501","items":[{"targetUrl":"https://example.com/direct75","title":"　期限　","tags":["工具"],"customSlug":"Direct75","redirectMode":"","expiresAt":"2099-01-01T00:00:00Z"},{"targetUrl":"https://example.com/intermediate75","title":"","tags":[],"customSlug":"","redirectMode":"intermediate","expiresAt":""},{"targetUrl":"https://example.com/confirmation75","title":"","tags":[],"customSlug":"Confirm75","redirectMode":"confirmation","expiresAt":"2099-02-01T12:34:56Z"}]}`
	for range 2 {
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-expirations", strings.NewReader(payload))
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
		for _, expected := range []struct{ target, mode, expiry string }{
			{"direct75", "direct", "2099-01-01T00:00:00Z"},
			{"intermediate75", "intermediate", ""},
			{"confirmation75", "confirmation", "2099-02-01T12:34:56Z"},
		} {
			var mode string
			var delay int
			var expiry pgtype.Timestamptz
			require.NoError(t, application.pool.QueryRow(t.Context(), `select redirect_mode,intermediate_delay_seconds,expires_at from short_link where target_url=$1`, "https://example.com/"+expected.target).Scan(&mode, &delay, &expiry))
			require.Equal(t, expected.mode, mode)
			require.Equal(t, 5, delay)
			require.Equal(t, expected.expiry != "", expiry.Valid)
			if expiry.Valid {
				require.Equal(t, expected.expiry, expiry.Time.UTC().Format(time.RFC3339))
			}
		}
		var links, audits, receipts int
		require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url like 'https://example.com/%75'),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch where request_id=$1::uuid)`, key).Scan(&links, &audits, &receipts))
		require.Equal(t, []int{3, 3, 1}, []int{links, audits, receipts})
	}
}

// TestBulkExpirationCalendarHTTP catches permissive date normalization and the wrong public error.
func TestBulkExpirationCalendarHTTP(t *testing.T) {
	application := newTestApplication(t)
	cookie := domainOrderLogin(t, application)
	for index, tc := range []struct {
		value string
		code  int
	}{
		{"", 0}, {"2400-02-29T23:59:59Z", 0}, {"9999-12-31T23:59:59Z", 0},
		{"0001-01-01T00:00:00Z", 200108}, {"2000-02-29T00:00:00Z", 200108},
		{"0000-01-01T00:00:00Z", 100001}, {"2100-02-29T00:00:00Z", 100001},
		{"2025-02-29T00:00:00Z", 100001}, {"2099-04-31T00:00:00Z", 100001},
		{"2099-00-01T00:00:00Z", 100001}, {"2099-13-01T00:00:00Z", 100001},
		{"2099-01-00T00:00:00Z", 100001}, {"2099-01-32T00:00:00Z", 100001},
		{"2099-01-01T24:00:00Z", 100001}, {"2099-01-01T00:60:00Z", 100001},
		{"2099-01-01T23:59:60Z", 100001}, {"2099-01-01t00:00:00Z", 100001},
		{"2099-01-01T00:00:00z", 100001}, {"2099-01-01 00:00:00Z", 100001},
		{"2099-01-01T00:00:00+00:00", 100001}, {"2099-01-01T00:00:00-00:00", 100001},
		{"2099-01-01T00:00:00.0Z", 100001}, {"2099-01-01T00:00:00,0Z", 100001},
		{"2099-1-01T00:00:00Z", 100001}, {"2099-01-1T00:00:00Z", 100001},
		{" 2099-01-01T00:00:00Z", 100001}, {"2099-01-01T00:00:00Z ", 100001},
		{"2099-01-01T00:00:00Z\n", 100001}, {"2099-01-01", 100001},
		{"infinity", 100001}, {"10000-01-01T00:00:00Z", 100001},
	} {
		t.Run(fmt.Sprintf("%02d/%s", index, tc.value), func(t *testing.T) {
			expiry, err := json.Marshal(tc.value)
			require.NoError(t, err)
			payload := fmt.Sprintf(`{"requestId":"11111111-1111-4111-8111-%012d","items":[{"targetUrl":"https://example.com/calendar/%d","title":"","tags":[],"customSlug":"","redirectMode":"","expiresAt":%s}]}`, 7500+index, index, expiry)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/batch-create-with-expirations", strings.NewReader(payload))
			request.Header.Set("Content-Type", "application/json")
			request.AddCookie(cookie)
			response := httptest.NewRecorder()
			application.server.Handler.ServeHTTP(response, request)
			require.Equal(t, http.StatusOK, response.Code)
			var body struct {
				Code int `json:"code"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, tc.code, body.Code, response.Body.String())
			var links, receipts int
			require.NoError(t, application.pool.QueryRow(t.Context(), `select (select count(*) from short_link where target_url=$1),(select count(*) from short_link_create_batch where request_id=$2::uuid)`, fmt.Sprintf("https://example.com/calendar/%d", index), fmt.Sprintf("11111111-1111-4111-8111-%012d", 7500+index)).Scan(&links, &receipts))
			if tc.code == 0 {
				require.Equal(t, []int{1, 1}, []int{links, receipts})
			} else {
				require.Equal(t, []int{0, 0}, []int{links, receipts})
			}
		})
	}
}
