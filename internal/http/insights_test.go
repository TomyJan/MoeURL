package http_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/stretchr/testify/require"
)

// TestInsightRoutesRejectGuestWithoutExposingData catches missing or publicly readable API registrations.
func TestInsightRoutesRejectGuestWithoutExposingData(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Insights: insights.NewService(nil, permission.NewService())})
	for _, path := range []string{"/api/v1/admin/dashboard", "/api/v1/short-link/visits?id=00000000-0000-0000-0000-000000000001", "/api/v1/admin/short-link/visits?id=00000000-0000-0000-0000-000000000001"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		var body struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		require.Equal(t, 120001, body.Code)
		require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	}
}
