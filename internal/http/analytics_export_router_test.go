package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// exportRouterResolver supplies a signed-in identity for independent export route tests.
type exportRouterResolver struct{ actor auth.CurrentUser }

// ResolveCurrentUser returns the fixture identity through the real session middleware.
func (r exportRouterResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.actor, nil
}

// exportRouterPort records which independent export operation receives the request context.
type exportRouterPort struct {
	actor  auth.CurrentUser
	input  shortlink.StatisticsInput
	calls  int
	admin  bool
	result shortlink.StatisticsExport
}

// ExportStatistics records the personal export dispatch without implementing shortlink.Port.
func (s *exportRouterPort) ExportStatistics(_ context.Context, actor auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsExport, error) {
	s.actor, s.input = actor, input
	s.calls++
	return s.result, nil
}

// AdminExportStatistics records administrative dispatch separately from personal exports.
func (s *exportRouterPort) AdminExportStatistics(ctx context.Context, actor auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsExport, error) {
	s.admin = true
	return s.ExportStatistics(ctx, actor, input)
}

// TestRouterRegistersAnalyticsExportRoutes verifies both routes use the independent export dependency.
func TestRouterRegistersAnalyticsExportRoutes(t *testing.T) {
	for _, entry := range []struct {
		name, path string
		admin      bool
	}{
		{"personal", "/api/v1/short-link/statistics/export", false},
		{"administrative", "/api/v1/admin/short-link/statistics/export", true},
	} {
		t.Run(entry.name, func(t *testing.T) {
			actor := auth.CurrentUser{ID: "export-actor", Username: "export-user", GroupKey: "user"}
			service := &exportRouterPort{result: shortlink.StatisticsExport{
				FileName:    "moeurl-statistics-route1-2026-10-01-2026-10-02.csv",
				ContentType: "text/csv;charset=utf-8", Content: "\ufeffsection,key,value,visit_count\r\n",
			}}
			router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: exportRouterResolver{actor: actor}, ShortLinkExport: service})
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, entry.path+"?id=link-id&startDate=2026-10-01&endDate=2026-10-02", nil)
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "export-session"})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			require.Equal(t, http.StatusOK, response.Code)
			require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
			require.Equal(t, 1, service.calls)
			require.Equal(t, entry.admin, service.admin)
			require.Equal(t, actor, service.actor)
			require.Equal(t, shortlink.StatisticsInput{ID: "link-id", StartDate: "2026-10-01", EndDate: "2026-10-02"}, service.input)
			var body struct {
				Code int                        `json:"code"`
				Data shortlink.StatisticsExport `json:"data"`
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Zero(t, body.Code)
			require.Equal(t, service.result, body.Data)
		})
	}
}
