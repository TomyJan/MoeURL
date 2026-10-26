package http_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBatchTagsRoutesRejectGuest verifies both registered real-service boundaries and no-store responses.
func TestBatchTagsRoutesRejectGuest(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatchTags: shortlink.NewService(nil, permission.NewService())})
	for _, path := range []string{"/api/v1/short-link/batch-tags", "/api/v1/admin/short-link/batch-tags"} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(`{"items":[{"id":"00000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-10-23T00:00:00Z"}],"operation":"replace","tags":[]}`))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":120001`)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	}
}
