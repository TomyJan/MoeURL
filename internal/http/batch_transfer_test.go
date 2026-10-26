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

// TestBatchTransferRouteRejectsGuest requires the batch endpoint to enforce current authorization.
func TestBatchTransferRouteRejectsGuest(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatchTransfer: shortlink.NewService(nil, permission.NewService())})
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/admin/short-link/batch-transfer", strings.NewReader(`{"items":[{"id":"00000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-10-23T00:00:00Z"}],"newOwnerUsername":"recipient"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"code":120001`)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}
