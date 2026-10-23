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

// TestTransferRouteRejectsGuest verifies the real endpoint's authentication and no-store boundary.
func TestTransferRouteRejectsGuest(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkTransfer: shortlink.NewService(nil, permission.NewService())})
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/admin/short-link/transfer", strings.NewReader(`{"id":"00000000-0000-0000-0000-000000000001","newOwnerUsername":"recipient","expectedUpdatedAt":"2026-10-23T00:00:00Z"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"code":120001`)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}
