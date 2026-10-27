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
	"github.com/TomyJan/MoeURL/internal/user"
)

type domainPreferenceIdentity struct{}

// ResolveCurrentUser binds the isolated transport fixture to a concrete session identity.
func (domainPreferenceIdentity) ResolveCurrentUser(_ context.Context, token string) (auth.CurrentUser, error) {
	if token == "preference-session" {
		return auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000826", GroupKey: "user"}, nil
	}
	return auth.GuestUser(), nil
}

type routedDomainPreference struct{}

// Get rejects anonymous context and returns a stable account-scoped projection.
func (routedDomainPreference) Get(_ context.Context, actor auth.CurrentUser) (user.DomainPreferenceResult, error) {
	if actor.ID != "00000000-0000-0000-0000-000000000826" || actor.GroupKey != "user" {
		return user.DomainPreferenceResult{}, user.ErrPermissionDenied
	}
	return user.DomainPreferenceResult{}, nil
}

// Update validates the decoded independent write and preserves its UUID in the public response.
func (p routedDomainPreference) Update(ctx context.Context, actor auth.CurrentUser, input user.UpdateDomainPreferenceInput) (user.DomainPreferenceResult, error) {
	if _, err := p.Get(ctx, actor); err != nil {
		return user.DomainPreferenceResult{}, err
	}
	if input.DomainID == nil || *input.DomainID != "00000000-0000-0000-0000-000000000926" || input.ExpectedUpdatedAt != nil {
		return user.DomainPreferenceResult{}, user.ErrInvalidInput
	}
	version := "2026-10-27T00:00:00.123456Z"
	return user.DomainPreferenceResult{Preference: user.DomainPreference{DomainID: input.DomainID, UpdatedAt: &version}}, nil
}

// TestRouterDomainPreferenceSessionBoundary checks URL registration, JSON projection and private response caching together.
func TestRouterDomainPreferenceSessionBoundary(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: domainPreferenceIdentity{}, UserDomainPreference: routedDomainPreference{}})
	for _, authenticated := range []bool{false, true} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			path := "/api/v1/user/domain-preference"
			if method == http.MethodPost {
				path += "/update"
			}
			r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(`{"domainId":"00000000-0000-0000-0000-000000000926","expectedUpdatedAt":null}`))
			r.Header.Set("Content-Type", "application/json")
			if authenticated {
				r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "preference-session"})
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			var result struct {
				Code int
				Data user.DomainPreferenceResult
			}
			want := 120001
			if authenticated {
				want = 0
			}
			if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || result.Code != want || w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%s authenticated=%v response=%s decode=%v cache=%s", method, authenticated, w.Body.String(), err, w.Header().Get("Cache-Control"))
			}
			if authenticated && method == http.MethodPost {
				p := result.Data.Preference
				if p.DomainID == nil || *p.DomainID != "00000000-0000-0000-0000-000000000926" || p.UpdatedAt == nil || *p.UpdatedAt != "2026-10-27T00:00:00.123456Z" {
					t.Fatalf("independent payload or precision lost at the router boundary: %#v", p)
				}
			}
		}
	}
}
