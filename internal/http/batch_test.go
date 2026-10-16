package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type routerBatchPort struct{ personal, admin int }

// Batch records personal route dispatch with the resolved request identity.
func (s *routerBatchPort) Batch(_ context.Context, actor auth.CurrentUser, input shortlink.BatchInput) (shortlink.BatchResult, error) {
	s.personal++
	if actor.GroupKey != "guest" || input.Action != "enable" {
		return shortlink.BatchResult{}, shortlink.ErrInvalidInput
	}
	return shortlink.BatchResult{AffectedCount: 1}, nil
}

// AdminBatch records administrative route dispatch independently of personal operations.
func (s *routerBatchPort) AdminBatch(_ context.Context, actor auth.CurrentUser, input shortlink.BatchInput) (shortlink.BatchResult, error) {
	s.admin++
	if actor.GroupKey != "guest" || input.Action != "enable" {
		return shortlink.BatchResult{}, shortlink.ErrInvalidInput
	}
	return shortlink.BatchResult{AffectedCount: 1}, nil
}

// TestRouterBatchRegistersIndependentNoStoreEndpoints verifies batch registration without the existing short-link Port.
func TestRouterBatchRegistersIndependentNoStoreEndpoints(t *testing.T) {
	port := &routerBatchPort{}
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatch: port})
	for _, path := range []string{"/api/v1/short-link/batch", "/api/v1/admin/short-link/batch"} {
		req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(`{"ids":["00000000-0000-0000-0000-000000000001"],"action":"enable"}`))
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		require.Equal(t, http.StatusOK, res.Code)
		require.Contains(t, res.Header().Get("Cache-Control"), "no-store")
		var body struct {
			Code int                   `json:"code"`
			Data shortlink.BatchResult `json:"data"`
		}
		require.NoError(t, json.Unmarshal(res.Body.Bytes(), &body))
		require.Zero(t, body.Code)
		require.Equal(t, int64(1), body.Data.AffectedCount)
	}
	require.Equal(t, 1, port.personal)
	require.Equal(t, 1, port.admin)
}
