package http_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// routerPasswordPort verifies password routes use their own explicit session authorization.
type routerPasswordPort struct{}

// passwordRouteResolver catches any redundant identity middleware on password routes.
type passwordRouteResolver struct{ t *testing.T }

// ResolveCurrentUser rejects invocation because PasswordPort owns credential authentication.
func (resolver passwordRouteResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	resolver.t.Error("password route invoked current-user resolver")
	return auth.GuestUser(), nil
}

// PasswordStatus returns a valid capability only for the supplied route fixture cookie.
func (routerPasswordPort) PasswordStatus(_ context.Context, session string) (auth.PasswordStatus, error) {
	if session != "current" {
		return auth.PasswordStatus{}, auth.ErrInvalidSession
	}
	return auth.PasswordStatus{CanChangePassword: true}, nil
}

// ChangePassword returns success only for the authenticated route fixture.
func (routerPasswordPort) ChangePassword(_ context.Context, session string, _ auth.ChangePasswordInput) error {
	if session != "current" {
		return auth.ErrInvalidSession
	}
	return nil
}

// TestRouterPasswordRoutesAuthenticateAndDoNotCache verifies registration and independent session validation.
func TestRouterPasswordRoutesAuthenticateAndDoNotCache(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Password: routerPasswordPort{}, CurrentUser: passwordRouteResolver{t: t}})
	for _, endpoint := range []struct{ method, path, body string }{{"GET", "/api/v1/auth/password/status", ""}, {"POST", "/api/v1/auth/password/change", `{"currentPassword":"old","newPassword":"new-password"}`}} {
		for _, cookie := range []bool{false, true} {
			r := httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(endpoint.body))
			r.Header.Set("Content-Type", "application/json")
			if cookie {
				r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "current"})
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			want := 401
			if cookie {
				want = 200
			}
			if w.Code != want || w.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("%s cookie=%t response=%d %s", endpoint.path, cookie, w.Code, w.Body.String())
			}
		}
	}
}

// TestRouterPasswordBodyRejectionDoesNotCache verifies global body rejection obeys the password API cache contract.
func TestRouterPasswordBodyRejectionDoesNotCache(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Password: routerPasswordPort{}})
	for _, contentLength := range []int64{-1, middleware.MaxJSONBodyBytes + 1} {
		r := httptest.NewRequest("POST", "/api/v1/auth/password/change", strings.NewReader(strings.Repeat("x", middleware.MaxJSONBodyBytes+1)))
		r.ContentLength = contentLength
		r.Header.Set("Content-Type", "application/json")
		r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "current"})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"code":100001`) || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("body rejection response=%d cache=%q body=%s", w.Code, w.Header().Get("Cache-Control"), w.Body.String())
		}
	}
}
