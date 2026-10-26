package http_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/stretchr/testify/require"
)

// TestVisitExportRoutesRejectGuestAndPaging checks real handlers keep private exports bounded even without identity services.
func TestVisitExportRoutesRejectGuestAndPaging(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{VisitExport: insights.NewService(nil, nil)})
	for _, prefix := range []string{"", "/admin"} {
		for _, tc := range []struct {
			query string
			code  int
		}{{"id=00000000-0000-0000-0000-000000000001", 120001}, {"id=00000000-0000-0000-0000-000000000001&pageSize=25", 100001}, {"id=invalid", 100001}} {
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest("GET", "/api/v1"+prefix+"/short-link/visits/export?"+tc.query, nil))
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
}
