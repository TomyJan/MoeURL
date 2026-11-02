package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type tagCatalogHandlerPort func(context.Context, auth.CurrentUser, shortlink.TagCatalogInput) (shortlink.TagCatalogResult, error)

// ListTags supplies controlled storage results while retaining the real HTTP decoder and error mapping.
func (port tagCatalogHandlerPort) ListTags(ctx context.Context, actor auth.CurrentUser, input shortlink.TagCatalogInput) (shortlink.TagCatalogResult, error) {
	return port(ctx, actor, input)
}

// TestTagCatalogHandlerQueryContract catches malformed query acceptance, literal decoding and dropped response fields.
func TestTagCatalogHandlerQueryContract(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  string
	}{
		{"", ""}, {"q=", ""}, {"q=%25_%5CCaf%C3%A9+%E4%B8%AD", "%_\\Café 中"},
	} {
		t.Run(tc.query, func(t *testing.T) {
			port := tagCatalogHandlerPort(func(_ context.Context, _ auth.CurrentUser, input shortlink.TagCatalogInput) (shortlink.TagCatalogResult, error) {
				require.Equal(t, tc.want, input.Query)
				return shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{{Tag: "<b>literal</b>", LinkCount: 4}}, HasMore: true}, nil
			})
			response := httptest.NewRecorder()
			shortlink.NewTagCatalogHandler(port, nil).List(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/tags?"+tc.query, nil))
			require.Equal(t, http.StatusOK, response.Code)
			var body struct {
				Code int                        `json:"code"`
				Data shortlink.TagCatalogResult `json:"data"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, 0, body.Code)
			require.Equal(t, shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{{Tag: "<b>literal</b>", LinkCount: 4}}, HasMore: true}, body.Data)
		})
	}
	for _, query := range []string{"q=%zz", "q=x;y", "q", "q=x&", "q=a&q=b", "ownerId=other", "limit=1", "=x"} {
		t.Run("reject-"+query, func(t *testing.T) {
			port := tagCatalogHandlerPort(func(context.Context, auth.CurrentUser, shortlink.TagCatalogInput) (shortlink.TagCatalogResult, error) {
				t.Fatal("Malformed HTTP query reached storage")
				return shortlink.TagCatalogResult{}, nil
			})
			response := httptest.NewRecorder()
			shortlink.NewTagCatalogHandler(port, nil).List(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/tags?"+query, nil))
			require.Equal(t, http.StatusOK, response.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, float64(100001), body["code"])
			require.Nil(t, body["data"])
		})
	}
}

// TestTagCatalogHandlerSafeErrors catches wrong business mappings and accidental disclosure of storage or search details.
func TestTagCatalogHandlerSafeErrors(t *testing.T) {
	for _, tc := range []struct {
		name   string
		err    error
		status int
		code   float64
	}{
		{"input", shortlink.ErrInvalidInput, 200, 100001},
		{"permission", shortlink.ErrPermissionDenied, 200, 120001},
		{"storage", errors.New("private-storage-secret"), 500, 900000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			logger := slog.New(slog.NewTextHandler(&logs, nil))
			port := tagCatalogHandlerPort(func(context.Context, auth.CurrentUser, shortlink.TagCatalogInput) (shortlink.TagCatalogResult, error) {
				return shortlink.TagCatalogResult{}, tc.err
			})
			response := httptest.NewRecorder()
			shortlink.NewTagCatalogHandler(port, logger).List(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/tags?q=private-search", nil))
			require.Equal(t, tc.status, response.Code)
			var body map[string]any
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, tc.code, body["code"])
			require.Nil(t, body["data"])
			require.NotContains(t, response.Body.String()+logs.String(), "private-storage-secret")
			require.NotContains(t, response.Body.String()+logs.String(), "private-search")
			if tc.status == 500 {
				require.Contains(t, logs.String(), "short_link_tag_catalog_failed")
			}
		})
	}
}
