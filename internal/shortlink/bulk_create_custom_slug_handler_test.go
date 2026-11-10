package shortlink_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

const customSlugHTTPJSON = `{"requestId":"11111111-1111-4111-8111-111111115609","items":[{"targetUrl":"https://example.org/metadata","title":" raw ","tags":["　tag　","a,b"],"customSlug":"TeamDocs56"}]}`

type customSlugHTTPPort struct{ err error }

// BatchCreateWithCustomSlugs replaces only storage and rejects loss of raw ordered wire content.
func (p customSlugHTTPPort) BatchCreateWithCustomSlugs(_ context.Context, _ auth.CurrentUser, input shortlink.BatchCreateWithCustomSlugsInput) (shortlink.BatchCreateResult, error) {
	if len(input.Items) != 1 || input.Items[0].CustomSlug != "TeamDocs56" {
		return shortlink.BatchCreateResult{}, errors.New("raw custom code differs")
	}
	if input.RequestID != "11111111-1111-4111-8111-111111115609" || len(input.Items) != 1 || input.Items[0].TargetURL != "https://example.org/metadata" || input.Items[0].Title != " raw " || len(input.Items[0].Tags) != 2 || input.Items[0].Tags[0] != "　tag　" || input.Items[0].Tags[1] != "a,b" {
		return shortlink.BatchCreateResult{}, errors.New("decoded metadata differs")
	}
	return shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: 1}, p.err
}

// TestBulkCustomSlugHTTPBoundary catches body, object and array framing accepted beyond the wire contract.
func TestBulkCustomSlugHTTPBoundary(t *testing.T) {
	row := `{"targetUrl":"https://example.org/metadata","title":" raw ","tags":["　tag　","a,b"],"customSlug":"TeamDocs56"}`
	wrap := func(item string) string {
		return `{"requestId":"11111111-1111-4111-8111-111111115609","items":[` + item + `]}`
	}
	invalid := []string{
		`{"requestId":"11111111-1111-4111-8111-111111115609","items":[{"tags":["tag"`,
		"", `null`, `[]`, `{}`, `{"requestId":`, `{"requestId":null}`, `{"requestId":3,"items":[` + row + `]}`,
		`{"requestId":"11111111-1111-4111-8111-111111115609","items":null}`, `{"requestId":"11111111-1111-4111-8111-111111115609","items":{}}`,
		strings.Replace(customSlugHTTPJSON, `"items":`, `"items":[],"items":`, 1),
		strings.Replace(customSlugHTTPJSON, `"requestId":`, `"extra":[],"requestId":`, 1),
		strings.Replace(customSlugHTTPJSON, `"items":`, `"requestId":"duplicate","items":`, 1),
		wrap(`null`), wrap(`[]`), wrap(`{}`), wrap(row + `,` + row), wrap(strings.TrimSuffix(strings.Repeat(row+`,`, 21), `,`)),
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":null`, 1)),
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":[null]`, 1)),
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":[{}]`, 1)),
		`{"requestId":"11111111-1111-4111-8111-111111115609","items":[{"title":`,
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":["tag"`, 1)),
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":["1","2","3","4","5","6","7","8","9","10","11"]`, 1)),
		wrap(strings.Replace(row, `"tags":["　tag　","a,b"]`, `"tags":[],"tags":[]`, 1)),
		wrap(strings.Replace(row, `" raw "`, `null`, 1)),
		wrap(strings.Replace(row, `"title":`, `"unknown":`, 1)),
		wrap(strings.Replace(row, `"title":`, `"title":"duplicate","title":`, 1)),
		customSlugHTTPJSON + `{}`, customSlugHTTPJSON + `trailing`, strings.TrimSuffix(customSlugHTTPJSON, "}"),
		strings.Replace(customSlugHTTPJSON, `" raw "`, `"\ud800"`, 1),
		strings.Replace(customSlugHTTPJSON, `"　tag　"`, `"\udfff"`, 1),
		strings.Replace(customSlugHTTPJSON, `"　tag　"`, `"\ud800\u0041"`, 1),
		strings.Replace(customSlugHTTPJSON, `"　tag　"`, "\""+string([]byte{0xff})+"\"", 1),
		customSlugHTTPJSON + strings.Repeat(" ", 65537-len(customSlugHTTPJSON)),
	}
	for _, body := range invalid {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateCustomSlugHandler(customSlugHTTPPort{}, nil).BatchCreateWithCustomSlugs(response, request)
		require.Equal(t, 200, response.Code)
		require.Contains(t, response.Body.String(), `"code":100001`, body)
		require.NotContains(t, response.Body.String(), "createdCount")
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(customSlugHTTPJSON))
		request.Header.Set("Content-Type", media)
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateCustomSlugHandler(customSlugHTTPPort{}, nil).BatchCreateWithCustomSlugs(response, request)
		require.Contains(t, response.Body.String(), `"code":100001`)
	}
	request := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	request.Header.Set("Content-Type", "application/json")
	request.Body = bulkBrokenBody{}
	response := httptest.NewRecorder()
	shortlink.NewBulkCreateCustomSlugHandler(customSlugHTTPPort{}, nil).BatchCreateWithCustomSlugs(response, request)
	require.Contains(t, response.Body.String(), `"code":100001`)
}

// TestBulkCustomSlugHTTPResult catches raw payload loss, boundary rejection and incorrect error classification.
func TestBulkCustomSlugHTTPResult(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code int
	}{{nil, 0}, {shortlink.ErrPermissionDenied, 120001}, {shortlink.ErrBulkCreateConflict, 200120}, {shortlink.ErrInvalidInput, 100001}, {shortlink.ErrInvalidTargetURL, 200103}, {shortlink.ErrReservedSlug, 200102}, {shortlink.ErrSlugConflict, 200101}} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(customSlugHTTPJSON+strings.Repeat(" ", 65536-len(customSlugHTTPJSON))))
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateCustomSlugHandler(customSlugHTTPPort{err: tc.err}, nil).BatchCreateWithCustomSlugs(response, request)
		var payload struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &payload))
		require.Equal(t, tc.code, payload.Code)
		if tc.code == 0 {
			require.Contains(t, response.Body.String(), `"createdCount":1`)
		}
	}
	for _, expected := range [][]string{{""}, {"stale"}, {"one", "two"}} {
		request := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(customSlugHTTPJSON))
		request.Header.Set("Content-Type", "application/json")
		request.Header["X-Moeurl-Expected-User-Id"] = expected
		response := httptest.NewRecorder()
		shortlink.NewBulkCreateCustomSlugHandler(customSlugHTTPPort{}, nil).BatchCreateWithCustomSlugs(response, request)
		require.Contains(t, response.Body.String(), `"code":120001`)
	}
}
