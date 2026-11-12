package http_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/stretchr/testify/require"
)

// TestGlobalVisitExportRouteRejectsGuestAndLinkFilters exercises real routing and fail-closed framing.
func TestGlobalVisitExportRouteRejectsGuestAndLinkFilters(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{GlobalVisitExport: insights.NewService(nil, nil)})
	for _, tc := range []struct {
		query string
		code  int
	}{{"", 120001}, {"?id=00000000-0000-0000-0000-000000000001", 100001}, {"?pageSize=25", 100001}, {"?days=7&days=30", 100001}} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), "GET", "/api/v1/admin/dashboard/visits/export"+tc.query, nil))
		require.Equal(t, 200, response.Code)
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
		var body struct {
			Code int
			Data any
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Equal(t, tc.code, body.Code)
		require.Nil(t, body.Data)
	}
}
