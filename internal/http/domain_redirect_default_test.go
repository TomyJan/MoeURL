package http_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/stretchr/testify/require"
)

type routerRedirectDefaults struct{}

// GetRedirectDefault echoes the actual decoded target at the service boundary.
func (routerRedirectDefaults) GetRedirectDefault(_ context.Context, _ auth.CurrentUser, id string) (domain.RedirectDefaultSetting, error) {
	return domain.RedirectDefaultSetting{DomainID: id, RedirectMode: "confirmation"}, nil
}

// SetRedirectDefault exposes the decoded command so a swapped or absent route fails.
func (routerRedirectDefaults) SetRedirectDefault(_ context.Context, _ auth.CurrentUser, input domain.SetRedirectDefaultInput) (domain.RedirectDefaultSetting, error) {
	return domain.RedirectDefaultSetting{DomainID: input.ID, RedirectMode: input.RedirectMode, UpdatedAt: input.ExpectedUpdatedAt}, nil
}

// RedirectDefaults supplies the independent self projection without a management DTO.
func (routerRedirectDefaults) RedirectDefaults(context.Context, auth.CurrentUser) ([]domain.EffectiveRedirectDefault, error) {
	return []domain.EffectiveRedirectDefault{{DomainID: "00000000-0000-0000-0000-000000000729", RedirectMode: "direct"}}, nil
}

// TestRouterDomainRedirectDefaultsContract catches absent or cross-wired semantic
// endpoints through their real decoded payloads, not mock-call counts.
func TestRouterDomainRedirectDefaultsContract(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{DomainRedirectDefault: routerRedirectDefaults{}})
	for _, test := range []struct {
		method, path, body string
		data               any
	}{
		{"GET", "/api/v1/admin/domain/redirect-default?id=00000000-0000-0000-0000-000000000729", "", map[string]any{"setting": map[string]any{"domainId": "00000000-0000-0000-0000-000000000729", "redirectMode": "confirmation", "updatedAt": ""}}},
		{"POST", "/api/v1/admin/domain/set-redirect-default", `{"id":"00000000-0000-0000-0000-000000000729","redirectMode":"intermediate","expectedUpdatedAt":"2026-10-28T00:00:00Z"}`, map[string]any{"setting": map[string]any{"domainId": "00000000-0000-0000-0000-000000000729", "redirectMode": "intermediate", "updatedAt": "2026-10-28T00:00:00Z"}}},
		{"GET", "/api/v1/domain/redirect-defaults", "", map[string]any{"items": []any{map[string]any{"domainId": "00000000-0000-0000-0000-000000000729", "redirectMode": "direct"}}}},
	} {
		r := httptest.NewRequestWithContext(t.Context(), test.method, test.path, strings.NewReader(test.body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body struct {
			Code int
			Data any
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		require.Zero(t, body.Code)
		require.Equal(t, test.data, body.Data)
	}
}
