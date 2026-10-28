package http_test

import (
	"net/http/httptest"
	"strings"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// TestBatchMembershipRoute rejects a guest at the real command instead of falling through to API-not-found.
func TestBatchMembershipRoute(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{UserBatchMembership: user.NewService(nil, nil)})
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/api/v1/admin/user/batch-change-group", strings.NewReader(`{"items":[{"id":"00000000-0000-4000-8000-000000000001","expectedUpdatedAt":"2026-10-28T00:00:00Z"}],"groupKey":"admin"}`))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code)
	require.Contains(t, w.Body.String(), `"code":120001`)
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
}
