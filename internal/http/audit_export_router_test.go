package http_test

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/stretchr/testify/require"
)

// TestAuditExportRouteRejectsGuestAndPaging verifies GET is registered without adding write verbs.
func TestAuditExportRouteRejectsGuestAndPaging(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{AuditExport: insights.NewService(nil, nil)})
	for _, tc := range []struct {
		query string
		code  int
	}{{"", 120001}, {"pageSize=25", 100001}, {"cursor=x", 100001}, {"actorId=invalid", 100001}} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest("GET", "/api/v1/admin/audit/export?"+tc.query, nil))
		require.Equal(t, 200, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body struct {
			Code int
			Data any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Equal(t, tc.code, body.Code)
		require.Nil(t, body.Data)
	}
	for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(method, "/api/v1/admin/audit/export", nil))
		require.Equal(t, 405, w.Code)
	}
}
