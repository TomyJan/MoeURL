package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

const bulkCreateHTTPJSON = `{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":["https://example.com/private-bulk","https://example.org/second"]}`

type bulkCreateHTTPPort struct{ err error }

// BatchCreate isolates the slow database boundary while HTTP tests exercise actual decoding and response behavior.
func (p bulkCreateHTTPPort) BatchCreate(_ context.Context, _ auth.CurrentUser, input shortlink.BatchCreateInput) (shortlink.BatchCreateResult, error) {
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: len(input.TargetURLs)}, p.err
}

type bulkBrokenBody struct{}

func (bulkBrokenBody) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
func (bulkBrokenBody) Close() error             { return nil }

// TestBulkCreateHTTPFraming catches ambiguous JSON, body overflows and accidentally accepted unsafe target input.
func TestBulkCreateHTTPFraming(t *testing.T) {
	invalid := []string{
		"", `null`, `[]`, `{}`, `{"requestId":`, bulkCreateHTTPJSON + ` {}`, bulkCreateHTTPJSON + ` trailing`,
		strings.Replace(bulkCreateHTTPJSON, `"targetUrls":`, `"unknown":true,"targetUrls":`, 1),
		strings.Replace(bulkCreateHTTPJSON, `"targetUrls":`, `"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":`, 1),
		`{"requestId":null,"targetUrls":["https://example.com"]}`,
		`{"requestId":12,"targetUrls":["https://example.com"]}`,
		`{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":null}`,
		`{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":[null]}`,
		`{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":{}}`,
		strings.Replace(bulkCreateHTTPJSON, "private-bulk", string([]byte{255}), 1),
		strings.Replace(bulkCreateHTTPJSON, "private-bulk", "中文", 1),
		bulkCreateHTTPJSON + strings.Repeat(" ", 64*1024-len(bulkCreateHTTPJSON)+1),
	}
	for i, body := range invalid {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{}, nil).BatchCreate(response, request)
		require.Equal(t, 200, response.Code)
		require.Contains(t, response.Body.String(), `"code":100001`, "case %d", i)
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(bulkCreateHTTPJSON))
		request.Header.Set("Content-Type", media)
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{}, nil).BatchCreate(response, request)
		require.Contains(t, response.Body.String(), `"code":100001`)
	}
	request := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	request.Header.Set("Content-Type", "application/json")
	request.Body = bulkBrokenBody{}
	response := httptest.NewRecorder()
	shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{}, nil).BatchCreate(response, request)
	require.Contains(t, response.Body.String(), `"code":100001`)
	for _, body := range []string{bulkCreateHTTPJSON, bulkCreateHTTPJSON + strings.Repeat(" ", 64*1024-len(bulkCreateHTTPJSON))} {
		request = httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
		response = httptest.NewRecorder()
		shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{}, nil).BatchCreate(response, request)
		require.Contains(t, response.Body.String(), `"createdCount":2`)
		require.Contains(t, response.Body.String(), `"code":0`)
	}
	request = httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(strings.Replace(bulkCreateHTTPJSON, "https://example.com/private-bulk", "http://127.0.0.1/private-bulk", 1)))
	request.Header.Set("Content-Type", "application/json")
	response = httptest.NewRecorder()
	shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{}, nil).BatchCreate(response, request)
	require.Contains(t, response.Body.String(), `"code":200103`)
}

// TestBulkCreateHTTPOutcomes catches wrong business codes and leakage of private URLs or database diagnostics.
func TestBulkCreateHTTPOutcomes(t *testing.T) {
	for _, tc := range []struct {
		err          error
		code, status int
	}{
		{nil, 0, 200},
		{shortlink.ErrInvalidInput, 100001, 200}, {shortlink.ErrPermissionDenied, 120001, 200},
		{shortlink.ErrInvalidTargetURL, 200103, 200}, {shortlink.ErrDomainUnavailable, 200114, 200},
		{shortlink.ErrSlugConflict, 200101, 200}, {shortlink.ErrBulkCreateConflict, 200120, 200},
		{context.Canceled, 900000, 500}, {context.DeadlineExceeded, 900000, 500},
		{errors.New("https://example.com/private-bulk SQLSTATE 23505 secret-body"), 900000, 500},
	} {
		var logs bytes.Buffer
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(bulkCreateHTTPJSON))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateHandler(bulkCreateHTTPPort{tc.err}, slog.New(slog.NewJSONHandler(&logs, nil))).BatchCreate(response, request)
		require.Equal(t, tc.status, response.Code)
		var body struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Equal(t, tc.code, body.Code)
		for _, secret := range []string{"private-bulk", "SQLSTATE", "23505", "secret-body"} {
			require.NotContains(t, logs.String(), secret)
			require.NotContains(t, response.Body.String(), secret)
		}
	}
}
