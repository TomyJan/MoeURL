package http_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/user"
)

func TestRouterHealthReturnsOK(t *testing.T) {
	router := apphttp.NewRouter()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/health", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
	}

	var body struct {
		Code    int               `json:"code"`
		Message string            `json:"message"`
		Data    map[string]string `json:"data"`
		Meta    map[string]any    `json:"meta"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if body.Message != "OK" {
		t.Fatalf("expected message OK, got %q", body.Message)
	}
	if body.Data["status"] != "ok" {
		t.Fatalf("expected status ok, got %q", body.Data["status"])
	}
}

func TestRouterServesSPAFixedRoutesFromStaticDir(t *testing.T) {
	staticDir := t.TempDir()
	err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644)
	if err != nil {
		t.Fatalf("write index: %v", err)
	}
	router := apphttp.NewRouter(apphttp.Dependencies{StaticDir: staticDir})

	for _, path := range []string{
		"/",
		"/setup",
		"/login",
		"/profile",
		"/console",
		"/link",
		"/analytics",
		"/admin/link",
		"/admin/user",
		"/admin/user/group",
		"/admin/setting",
		"/admin/user/new",
	} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
			}
			if response.Body.String() == "" {
				t.Fatal("expected index body")
			}
		})
	}
}

func TestRouterIntermediateFixedRoutesTakePriorityOverSlugRedirect(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	redirect := &routerRedirectService{
		previewResult:  shortlink.PreviewResult{Slug: "middle", TargetHost: "example.com", IntermediateDelaySeconds: int16Pointer(5)},
		continueResult: shortlink.RedirectResult{TargetURL: "https://example.com/final", ShortLinkID: "link-id"},
	}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: redirect, StaticDir: staticDir})

	appShell := httptest.NewRecorder()
	router.ServeHTTP(appShell, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/middle", nil))
	if appShell.Code != http.StatusOK || appShell.Body.String() == "" {
		t.Fatalf("expected intermediate app shell, got status %d body %q", appShell.Code, appShell.Body.String())
	}
	if len(redirect.openSlugs) != 0 {
		t.Fatalf("expected app shell not to resolve a short link, got %#v", redirect.openSlugs)
	}

	scopedPreview := httptest.NewRecorder()
	scopedPreviewRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/middle/preview", nil)
	scopedPreviewRequest.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "raw-token"})
	router.ServeHTTP(scopedPreview, scopedPreviewRequest)
	if scopedPreview.Code != http.StatusOK || redirect.previewToken != "raw-token" {
		t.Fatalf("expected scoped preview route to pass access cookie, got status %d token %q", scopedPreview.Code, redirect.previewToken)
	}

	continued := httptest.NewRecorder()
	continueRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/middle/continue", nil)
	continueRequest.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "raw-token"})
	router.ServeHTTP(continued, continueRequest)
	if continued.Code != http.StatusFound || continued.Header().Get("Location") != "https://example.com/final" {
		t.Fatalf("expected final redirect, got status %d location %q", continued.Code, continued.Header().Get("Location"))
	}
	if len(redirect.continueSlugs) != 1 || redirect.continueSlugs[0] != "middle" {
		t.Fatalf("expected continue route slug, got %#v", redirect.continueSlugs)
	}
	if redirect.continueToken != "raw-token" {
		t.Fatalf("expected continue route to pass access cookie, got %q", redirect.continueToken)
	}

	preview := httptest.NewRecorder()
	router.ServeHTTP(preview, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil))
	var body struct {
		Code int `json:"code"`
		Data struct {
			TargetHost string  `json:"targetHost"`
			TargetURL  *string `json:"targetUrl"`
		} `json:"data"`
	}
	if err := json.NewDecoder(preview.Body).Decode(&body); err != nil {
		t.Fatalf("decode preview: %v", err)
	}
	if preview.Code != http.StatusOK || body.Code != 0 || body.Data.TargetHost != "example.com" || body.Data.TargetURL != nil {
		t.Fatalf("unexpected preview response: status %d body %#v", preview.Code, body)
	}
	if len(redirect.previewSlugs) != 2 || redirect.previewSlugs[0] != "middle" || redirect.previewSlugs[1] != "middle" {
		t.Fatalf("expected both preview routes to pass slug, got %#v", redirect.previewSlugs)
	}
}

func TestRouterUnknownAPIUsesUnifiedResponse(t *testing.T) {
	router := apphttp.NewRouter()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/missing", nil)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
	}

	var body struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    any            `json:"data"`
		Meta    map[string]any `json:"meta"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 100001 {
		t.Fatalf("expected code 100001, got %d", body.Code)
	}
	if body.Data != nil {
		t.Fatalf("expected nil data, got %#v", body.Data)
	}
}

func TestRouterRegistersOptionalDependencies(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		System:      &routerSystemService{},
		Auth:        &routerAuthService{},
		CurrentUser: &routerCurrentUserResolver{},
		ShortLink:   &routerShortLinkService{},
		Redirect:    &routerRedirectService{},
		User:        &routerUserService{},
	})

	tests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/api/v1/init/status"},
		{method: http.MethodPost, path: "/api/v1/init/setup", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/auth/login", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/auth/logout"},
		{method: http.MethodGet, path: "/api/v1/auth/me"},
		{method: http.MethodPost, path: "/api/v1/short-link/create", body: `{}`},
		{method: http.MethodGet, path: "/api/v1/short-link/overview"},
		{method: http.MethodGet, path: "/api/v1/short-link/list"},
		{method: http.MethodPost, path: "/api/v1/short-link/update", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/short-link/delete", body: `{}`},
		{method: http.MethodGet, path: "/api/v1/admin/short-link/list"},
		{method: http.MethodPost, path: "/api/v1/admin/short-link/update", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/admin/short-link/delete", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/admin/user/create", body: `{}`},
		{method: http.MethodGet, path: "/api/v1/admin/user/list"},
		{method: http.MethodPost, path: "/api/v1/admin/user/update", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/admin/user/reset-password", body: `{}`},
		{method: http.MethodPost, path: "/api/v1/user/profile/update", body: `{}`},
		{method: http.MethodGet, path: "/api/v1/public/short-link/preview?slug=abc123"},
		{method: http.MethodPost, path: "/go/abc123/unlock", body: `{}`},
		{method: http.MethodGet, path: "/go/abc123/continue"},
		{method: http.MethodGet, path: "/go/abc123/preview"},
		{method: http.MethodGet, path: "/abc123"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequestWithContext(t.Context(), tt.method, tt.path, bytes.NewBufferString(tt.body))

			router.ServeHTTP(response, request)

			if response.Code < 200 || response.Code >= 400 {
				t.Fatalf("expected registered route, got status %d body %q", response.Code, response.Body.String())
			}
		})
	}
}

func TestRouterRedirectServiceKeepsConfiguredIntermediateResultWithEmptyTarget(t *testing.T) {
	redirect := &routerRedirectService{
		openResult:           shortlink.OpenResult{RedirectMode: shortlink.RedirectModeIntermediate, Slug: "middle"},
		openResultConfigured: true,
	}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: redirect})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/abc123", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/middle" {
		t.Fatalf("expected configured intermediate redirect, got status %d location %q", response.Code, response.Header().Get("Location"))
	}
}

type routerSystemService struct{}

func (routerSystemService) IsInitialized(context.Context) (bool, error) {
	return false, nil
}

func (routerSystemService) Setup(context.Context, system.SetupInput) error {
	return nil
}

type routerAuthService struct{}

func (routerAuthService) Login(context.Context, auth.LoginInput) (auth.LoginResult, error) {
	return auth.LoginResult{
		User:    auth.GuestUser(),
		Session: auth.Session{ID: "session-id", ExpiresAt: time.Now().Add(time.Hour)},
	}, nil
}

func (routerAuthService) Logout(context.Context, string) error {
	return nil
}

func (routerAuthService) Me(context.Context, string) (auth.CurrentUser, error) {
	return auth.GuestUser(), nil
}

type routerCurrentUserResolver struct{}

func (routerCurrentUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return auth.GuestUser(), nil
}

type routerShortLinkService struct{}

func (routerShortLinkService) Overview(context.Context, auth.CurrentUser) (shortlink.OverviewResult, error) {
	return shortlink.OverviewResult{}, nil
}

func (routerShortLinkService) Create(context.Context, auth.CurrentUser, shortlink.CreateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, nil
}

func (routerShortLinkService) List(context.Context, auth.CurrentUser, shortlink.ListInput) (shortlink.ListResult, error) {
	return shortlink.ListResult{}, nil
}

func (routerShortLinkService) Update(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, nil
}

func (routerShortLinkService) Delete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return nil
}

func (routerShortLinkService) Statistics(context.Context, auth.CurrentUser, shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	return shortlink.StatisticsResult{}, nil
}

func (routerShortLinkService) AdminList(context.Context, auth.CurrentUser, shortlink.ListInput) (shortlink.AdminListResult, error) {
	return shortlink.AdminListResult{}, nil
}

func (routerShortLinkService) AdminStatistics(context.Context, auth.CurrentUser, shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	return shortlink.StatisticsResult{}, nil
}

func (routerShortLinkService) AdminUpdate(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, nil
}

func (routerShortLinkService) AdminDelete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return nil
}

type routerRedirectService struct {
	openResult           shortlink.OpenResult
	openResultConfigured bool
	previewResult        shortlink.PreviewResult
	continueResult       shortlink.RedirectResult
	openSlugs            []string
	previewSlugs         []string
	continueSlugs        []string
	continueToken        string
	previewToken         string
}

func int16Pointer(value int16) *int16 {
	return &value
}

func (service *routerRedirectService) Open(_ context.Context, slug string) (shortlink.OpenResult, error) {
	service.openSlugs = append(service.openSlugs, slug)
	if !service.openResultConfigured {
		return shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com"}}, nil
	}
	return service.openResult, nil
}

// Preview records the slug and scoped token forwarded by router preview routes.
func (service *routerRedirectService) Preview(_ context.Context, slug string, accessToken string) (shortlink.PreviewResult, error) {
	service.previewSlugs = append(service.previewSlugs, slug)
	service.previewToken = accessToken
	if service.previewResult.Slug == "" {
		return shortlink.PreviewResult{Slug: "abc123", TargetHost: "example.com", IntermediateDelaySeconds: int16Pointer(5)}, nil
	}
	return service.previewResult, nil
}

// Unlock satisfies the redirect contract for router tests that do not exercise password verification.
func (service *routerRedirectService) Unlock(context.Context, string, string) (shortlink.AccessGrant, error) {
	return shortlink.AccessGrant{}, nil
}

// Continue records the slug forwarded by the fixed continue route.
func (service *routerRedirectService) Continue(_ context.Context, slug string, accessToken string) (shortlink.RedirectResult, error) {
	service.continueSlugs = append(service.continueSlugs, slug)
	service.continueToken = accessToken
	if service.continueResult.TargetURL == "" {
		return shortlink.RedirectResult{TargetURL: "https://example.com"}, nil
	}
	return service.continueResult, nil
}

type routerUserService struct{}

func (routerUserService) Create(context.Context, auth.CurrentUser, user.CreateInput) (user.CreateResult, error) {
	return user.CreateResult{}, nil
}

func (routerUserService) List(context.Context, auth.CurrentUser, user.ListInput) (user.ListResult, error) {
	return user.ListResult{}, nil
}

func (routerUserService) Update(context.Context, auth.CurrentUser, user.UpdateInput) (user.UpdateResult, error) {
	return user.UpdateResult{}, nil
}

func (routerUserService) UpdateProfile(context.Context, auth.CurrentUser, user.UpdateProfileInput) (user.UpdateProfileResult, error) {
	return user.UpdateProfileResult{}, nil
}

func (routerUserService) ResetPassword(context.Context, auth.CurrentUser, user.ResetPasswordInput) error {
	return nil
}
