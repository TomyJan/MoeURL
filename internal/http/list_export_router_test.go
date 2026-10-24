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

type listExportRouterPort struct {
	admin bool
	actor auth.CurrentUser
	input shortlink.ListExportInput
}

// ExportList captures scope and filters at the actual independent route boundary.
func (s *listExportRouterPort) ExportList(_ context.Context, actor auth.CurrentUser, input shortlink.ListExportInput) (shortlink.ListExport, error) {
	s.actor, s.input = actor, input
	return shortlink.ListExport{FileName: "moeurl-links-own.csv", ContentType: "text/csv;charset=utf-8", Content: "\ufeffid,short_url\r\n"}, nil
}

// AdminExportList preserves the administrative dispatch selected by routing.
func (s *listExportRouterPort) AdminExportList(ctx context.Context, actor auth.CurrentUser, input shortlink.ListExportInput) (shortlink.ListExport, error) {
	s.admin = true
	return s.ExportList(ctx, actor, input)
}

// TestRouterRegistersListExportRoutes protects both fixed route registrations and their authenticated dependency.
func TestRouterRegistersListExportRoutes(t *testing.T) {
	for _, admin := range []bool{false, true} {
		path := "/api/v1/short-link/export"
		if admin {
			path = "/api/v1/admin/short-link/export"
		}
		actor := auth.CurrentUser{ID: "list-export-actor", Username: "exporter", GroupKey: "user"}
		service := &listExportRouterPort{}
		router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: exportRouterResolver{actor: actor}, ShortLinkListExport: service})
		req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path+"?status=active&q=exact&tag=Case", nil)
		req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		require.Equal(t, 200, res.Code)
		require.Equal(t, "no-store", res.Header().Get("Cache-Control"))
		require.Equal(t, admin, service.admin)
		require.Equal(t, actor, service.actor)
		require.Equal(t, shortlink.ListExportInput{Status: "active", Query: "exact", Tag: "Case"}, service.input)
		var body struct {
			Code int                  `json:"code"`
			Data shortlink.ListExport `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		require.Zero(t, body.Code)
		require.Equal(t, "moeurl-links-own.csv", body.Data.FileName)
	}
}
