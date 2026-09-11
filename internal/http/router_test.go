package http_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/oidc"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/TomyJan/MoeURL/internal/usergroup"
)

// TestRouterRegistersOIDCPublicAndAdministrativeRoutes verifies OIDC routes retain their cache and identity boundaries.
func TestRouterRegistersOIDCPublicAndAdministrativeRoutes(t *testing.T) {
	providers := &routerOIDCProviderService{}
	login := &routerOIDCLoginService{}
	router := apphttp.NewRouter(apphttp.Dependencies{OIDCProvider: providers, OIDCLogin: login})
	for _, path := range []string{
		"/api/v1/auth/methods",
		"/api/v1/auth/oidc/company/start?returnTo=%2Fconsole",
		"/api/v1/admin/oidc/provider/list",
	} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil))
		if response.Code == http.StatusNotFound {
			t.Fatalf("OIDC route %s was not registered", path)
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("OIDC route %s Cache-Control = %q", path, response.Header().Get("Cache-Control"))
		}
	}
	if login.startCalls != 1 || providers.methodCalls != 1 || providers.listCalls != 1 {
		t.Fatalf("OIDC calls = start %d methods %d list %d", login.startCalls, providers.methodCalls, providers.listCalls)
	}
}

// TestRouterHealthReturnsOK verifies router health returns ok.
func TestRouterHealthReturnsOK(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Health: &routerHealthChecker{}})
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

// TestRouterHealthRoutesBypassCurrentUser verifies health checks never resolve session identity.
func TestRouterHealthRoutesBypassCurrentUser(t *testing.T) {
	checker := &routerHealthChecker{}
	resolver := &recordingRouterCurrentUserResolver{}
	router := apphttp.NewRouter(apphttp.Dependencies{Health: checker, CurrentUser: resolver})

	for _, testCase := range []struct {
		path          string
		wantPingCalls int
	}{
		{path: "/api/v1/health/live", wantPingCalls: 0},
		{path: "/api/v1/health/ready", wantPingCalls: 1},
		{path: "/api/v1/health", wantPingCalls: 1},
	} {
		checker.calls = 0
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, testCase.path, nil)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})
		response := httptest.NewRecorder()

		router.ServeHTTP(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", testCase.path, response.Code)
		}
		if checker.calls != testCase.wantPingCalls {
			t.Fatalf("%s Ping calls = %d, want %d", testCase.path, checker.calls, testCase.wantPingCalls)
		}
	}
	if resolver.calls != 0 {
		t.Fatalf("health route CurrentUser calls = %d, want 0", resolver.calls)
	}
}

// TestRouterReadinessWithoutDependencyFailsClosed verifies an isolated router never reports false readiness.
func TestRouterReadinessWithoutDependencyFailsClosed(t *testing.T) {
	router := apphttp.NewRouter()
	response := httptest.NewRecorder()

	router.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/health/ready", nil))

	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("readiness status = %d, want 503", response.Code)
	}
	var body struct {
		Code int `json:"code"`
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	if body.Code != 900000 || body.Data.Status != "unavailable" {
		t.Fatalf("readiness response = code %d status %q", body.Code, body.Data.Status)
	}
}

// TestRouterBusinessAPIDisablesCachingWithoutChangingStaticResponses verifies session-scoped API data is never cacheable.
func TestRouterBusinessAPIDisablesCachingWithoutChangingStaticResponses(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth:        &routerAuthService{},
		CurrentUser: &routerCurrentUserResolver{},
		StaticDir:   staticDir,
	})

	apiResponse := httptest.NewRecorder()
	router.ServeHTTP(apiResponse, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/auth/me", nil))
	if got := apiResponse.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("auth/me Cache-Control = %q, want no-store", got)
	}

	staticResponse := httptest.NewRecorder()
	router.ServeHTTP(staticResponse, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if got := staticResponse.Header().Get("Cache-Control"); got == "no-store" {
		t.Fatalf("static response Cache-Control = %q, want existing cache behavior", got)
	}
}

// TestRouterLogsOversizedRequests verifies request logging wraps the global body limit.
func TestRouterLogsOversizedRequests(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	authService := &recordingRouterAuthService{}
	router := apphttp.NewRouter(apphttp.Dependencies{Auth: authService, Logger: logger})
	body := `{"username":"alice","password":"` + strings.Repeat("a", 1<<20) + `"}`
	request := httptest.NewRequestWithContext(
		t.Context(),
		http.MethodPost,
		"/api/v1/auth/login",
		strings.NewReader(body),
	)
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("oversized response status = %d, want 200", response.Code)
	}
	var responseBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&responseBody); err != nil {
		t.Fatalf("decode oversized response: %v", err)
	}
	if responseBody.Code != 100001 {
		t.Fatalf("oversized response code = %d, want 100001", responseBody.Code)
	}
	if authService.loginCalls != 0 {
		t.Fatalf("oversized request Login calls = %d, want 0", authService.loginCalls)
	}
	if output := logs.String(); !strings.Contains(output, "msg=http_request") || !strings.Contains(output, "path=/api/v1/auth/login") {
		t.Fatalf("oversized request log = %q, want http_request path", output)
	}
}

// TestRouterStaticRoutesBypassCurrentUser verifies public application assets do not resolve session identity.
func TestRouterStaticRoutesBypassCurrentUser(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	resolver := &recordingRouterCurrentUserResolver{}
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: resolver, StaticDir: staticDir})

	for _, path := range []string{"/", "/go/example"} {
		response := httptest.NewRecorder()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, path, nil)
		request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

		router.ServeHTTP(response, request)

		if response.Code != http.StatusOK {
			t.Fatalf("%s status = %d, want 200", path, response.Code)
		}
	}
	if resolver.calls != 0 {
		t.Fatalf("static route CurrentUser calls = %d, want 0", resolver.calls)
	}
}

// TestRouterServesSPAFixedRoutesFromStaticDir verifies router serves spa fixed routes from static dir.
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

// TestRouterIntermediateFixedRoutesTakePriorityOverSlugRedirect verifies router intermediate fixed routes take priority over slug redirect.
func TestRouterIntermediateFixedRoutesTakePriorityOverSlugRedirect(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	redirect := &routerRedirectService{
		previewResult:  shortlink.PreviewResult{Slug: "middle", TargetHost: "example.com", IntermediateDelaySeconds: int16Pointer(5)},
		unlockResult:   shortlink.AccessGrant{Token: "issued-token"},
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
	if scopedPreview.Code != http.StatusOK || len(redirect.previewSlugs) != 1 || redirect.previewSlugs[0] != "middle" {
		t.Fatalf("expected scoped preview route, got status %d slugs %#v", scopedPreview.Code, redirect.previewSlugs)
	}
	if len(redirect.previewTokens) != 1 || redirect.previewTokens[0] != "raw-token" {
		t.Fatalf("expected scoped preview to pass access cookie, got %#v", redirect.previewTokens)
	}

	unlocked := httptest.NewRecorder()
	unlockRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/go/middle/unlock", strings.NewReader(`{"password":"correct horse"}`))
	router.ServeHTTP(unlocked, unlockRequest)
	if unlocked.Code != http.StatusOK || len(redirect.unlockSlugs) != 1 || redirect.unlockSlugs[0] != "middle" || redirect.unlockPassword != "correct horse" {
		t.Fatalf("expected fixed unlock route, got status %d slugs %#v password %q", unlocked.Code, redirect.unlockSlugs, redirect.unlockPassword)
	}
	unlockCookies := unlocked.Result().Cookies()
	if len(unlockCookies) != 1 {
		t.Fatalf("expected one unlock cookie, got %d", len(unlockCookies))
	}
	if unlockCookies[0].Name != "moeurl_short_link_access" || unlockCookies[0].Value != "issued-token" {
		t.Fatalf("unexpected unlock cookie identity: name %q token present %t", unlockCookies[0].Name, unlockCookies[0].Value != "")
	}
	if unlockCookies[0].Path != "/go/middle" || !unlockCookies[0].HttpOnly || unlockCookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("unexpected unlock cookie attributes: path %q httpOnly %t sameSite %d", unlockCookies[0].Path, unlockCookies[0].HttpOnly, unlockCookies[0].SameSite)
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
	publicPreviewRequest := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil)
	router.ServeHTTP(preview, publicPreviewRequest)
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
	if len(redirect.previewTokens) != 2 || redirect.previewTokens[1] != "" {
		t.Fatalf("expected public preview without access cookie, got %#v", redirect.previewTokens)
	}
}

// TestRouterContinueResponsesAreNeverCached verifies access changes are rechecked instead of reusing a prior redirect.
func TestRouterContinueResponsesAreNeverCached(t *testing.T) {
	redirect := &routerRedirectService{
		continueResult: shortlink.RedirectResult{TargetURL: "https://example.com/final", ShortLinkID: "link-id"},
	}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: redirect})

	allowed := httptest.NewRecorder()
	router.ServeHTTP(allowed, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/protected/continue", nil))
	if allowed.Code != http.StatusFound || allowed.Header().Get("Location") != "https://example.com/final" {
		t.Fatalf("allowed continue response = status %d location %q", allowed.Code, allowed.Header().Get("Location"))
	}
	if cacheControl := allowed.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("allowed continue Cache-Control = %q, want no-store", cacheControl)
	}

	redirect.err = shortlink.ErrPasswordRequired
	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/protected/continue", nil))
	if denied.Code != http.StatusFound || denied.Header().Get("Location") != "/go/protected?reason=password" {
		t.Fatalf("denied continue response = status %d location %q", denied.Code, denied.Header().Get("Location"))
	}
	if cacheControl := denied.Header().Get("Cache-Control"); cacheControl != "no-store" {
		t.Fatalf("denied continue Cache-Control = %q, want no-store", cacheControl)
	}
	if len(redirect.continueSlugs) != 2 {
		t.Fatalf("continue calls = %d, want 2", len(redirect.continueSlugs))
	}
}

// TestRouterScopedPreviewResponsesAreNeverCached verifies authorization changes are rechecked for cookie-scoped previews.
func TestRouterScopedPreviewResponsesAreNeverCached(t *testing.T) {
	redirect := &routerRedirectService{
		previewResult: shortlink.PreviewResult{Slug: "protected", TargetHost: "example.com"},
	}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: redirect})

	allowed := httptest.NewRecorder()
	router.ServeHTTP(allowed, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/protected/preview", nil))
	if allowed.Code != http.StatusOK || allowed.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("allowed preview response = status %d Cache-Control %q", allowed.Code, allowed.Header().Get("Cache-Control"))
	}
	var allowedBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(allowed.Body).Decode(&allowedBody); err != nil || allowedBody.Code != 0 {
		t.Fatalf("allowed preview body = %#v, decode error %v", allowedBody, err)
	}

	redirect.err = shortlink.ErrPasswordRequired
	denied := httptest.NewRecorder()
	router.ServeHTTP(denied, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/go/protected/preview", nil))
	if denied.Code != http.StatusOK || denied.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("denied preview response = status %d Cache-Control %q", denied.Code, denied.Header().Get("Cache-Control"))
	}
	var deniedBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(denied.Body).Decode(&deniedBody); err != nil || deniedBody.Code != shortlink.CodePasswordRequired {
		t.Fatalf("denied preview body = %#v, decode error %v", deniedBody, err)
	}
	if len(redirect.previewSlugs) != 2 {
		t.Fatalf("preview calls = %d, want 2", len(redirect.previewSlugs))
	}
}

// TestRouterUnknownAPIUsesUnifiedResponse verifies router unknown api uses unified response.
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

// TestRouterRegistersOptionalDependencies verifies router registers optional dependencies.
func TestRouterRegistersOptionalDependencies(t *testing.T) {
	userGroupService := &routerUserGroupService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		System:      &routerSystemService{},
		Auth:        &routerAuthService{},
		CurrentUser: &routerCurrentUserResolver{},
		ShortLink:   &routerShortLinkService{},
		Redirect:    &routerRedirectService{},
		User:        &routerUserService{},
		UserGroup:   userGroupService,
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
		{method: http.MethodGet, path: "/api/v1/admin/user-group/list"},
		{method: http.MethodPost, path: "/api/v1/admin/user-group/update-permissions", body: `{}`},
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
	if userGroupService.listCalls != 1 || userGroupService.updateCalls != 1 {
		t.Fatalf("user-group route calls = list %d update %d, want 1 and 1", userGroupService.listCalls, userGroupService.updateCalls)
	}
}

// TestRouterLogsUnknownInfrastructureErrorsWithInjectedLogger verifies every routed service uses the shared request logger for diagnostics.
func TestRouterLogsUnknownInfrastructureErrorsWithInjectedLogger(t *testing.T) {
	infrastructureErr := errors.New("database unavailable diagnostic")
	tests := []struct {
		name         string
		dependencies apphttp.Dependencies
		method       string
		path         string
		body         string
		cookie       bool
		logMessage   string
	}{
		{
			name:         "current user",
			dependencies: apphttp.Dependencies{CurrentUser: &routerCurrentUserResolver{err: infrastructureErr}, System: &routerSystemService{}},
			method:       http.MethodGet,
			path:         "/api/v1/init/status",
			cookie:       true,
			logMessage:   "auth_request_failed",
		},
		{
			name:         "system",
			dependencies: apphttp.Dependencies{System: &routerSystemService{err: infrastructureErr}},
			method:       http.MethodGet,
			path:         "/api/v1/init/status",
			logMessage:   "system_request_failed",
		},
		{
			name:         "authentication",
			dependencies: apphttp.Dependencies{Auth: &routerAuthService{err: infrastructureErr}},
			method:       http.MethodPost,
			path:         "/api/v1/auth/login",
			body:         `{}`,
			logMessage:   "auth_request_failed",
		},
		{
			name:         "short link",
			dependencies: apphttp.Dependencies{ShortLink: &routerShortLinkService{err: infrastructureErr}},
			method:       http.MethodGet,
			path:         "/api/v1/short-link/overview",
			logMessage:   "short_link_request_failed",
		},
		{
			name:         "public preview",
			dependencies: apphttp.Dependencies{Redirect: &routerRedirectService{err: infrastructureErr}},
			method:       http.MethodGet,
			path:         "/api/v1/public/short-link/preview?slug=abc123",
			logMessage:   "short_link_preview_failed",
		},
		{
			name:         "user",
			dependencies: apphttp.Dependencies{User: &routerUserService{err: infrastructureErr}},
			method:       http.MethodGet,
			path:         "/api/v1/admin/user/list",
			logMessage:   "user_request_failed",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			test.dependencies.Logger = slog.New(slog.NewTextHandler(&logs, nil))
			router := apphttp.NewRouter(test.dependencies)
			request := httptest.NewRequestWithContext(t.Context(), test.method, test.path, bytes.NewBufferString(test.body))
			request.Header.Set("X-Request-ID", "request-123")
			if test.cookie {
				request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})
			}
			response := httptest.NewRecorder()

			router.ServeHTTP(response, request)

			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status = %d, want 500; body %q", response.Code, response.Body.String())
			}
			if strings.Contains(response.Body.String(), infrastructureErr.Error()) {
				t.Fatalf("response exposed infrastructure error: %q", response.Body.String())
			}
			output := logs.String()
			for _, expected := range []string{"msg=" + test.logMessage, "request_id=request-123", infrastructureErr.Error()} {
				if !strings.Contains(output, expected) {
					t.Fatalf("log missing %q: %q", expected, output)
				}
			}
		})
	}
}

// TestRouterRedirectServiceKeepsConfiguredIntermediateResultWithEmptyTarget verifies router redirect service keeps configured intermediate result with empty target.
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

type routerSystemService struct {
	err error
}

// IsInitialized implements the corresponding operation for the surrounding test double.
func (service routerSystemService) IsInitialized(context.Context) (bool, error) {
	return false, service.err
}

// SetupTokenRequired implements the setup policy query for router wiring tests.
func (routerSystemService) SetupTokenRequired() bool {
	return false
}

// Setup implements the corresponding operation for the surrounding test double.
func (service routerSystemService) Setup(context.Context, system.SetupInput) error {
	return service.err
}

type routerAuthService struct {
	err error
}

type recordingRouterAuthService struct {
	loginCalls int
}

// Login records invocation before returning a successful test session.
func (service *recordingRouterAuthService) Login(context.Context, auth.LoginInput) (auth.LoginResult, error) {
	service.loginCalls++
	return auth.LoginResult{
		User:    auth.GuestUser(),
		Session: auth.Session{ID: "session-id", ExpiresAt: time.Now().Add(time.Hour)},
	}, nil
}

// Logout implements the corresponding operation for the recording test double.
func (*recordingRouterAuthService) Logout(context.Context, string) error {
	return nil
}

// Me implements the corresponding operation for the recording test double.
func (*recordingRouterAuthService) Me(context.Context, string) (auth.CurrentUser, error) {
	return auth.GuestUser(), nil
}

// Login implements the corresponding operation for the surrounding test double.
func (service routerAuthService) Login(context.Context, auth.LoginInput) (auth.LoginResult, error) {
	if service.err != nil {
		return auth.LoginResult{}, service.err
	}
	return auth.LoginResult{
		User:    auth.GuestUser(),
		Session: auth.Session{ID: "session-id", ExpiresAt: time.Now().Add(time.Hour)},
	}, nil
}

// Logout implements the corresponding operation for the surrounding test double.
func (service routerAuthService) Logout(context.Context, string) error {
	return service.err
}

// Me implements the corresponding operation for the surrounding test double.
func (service routerAuthService) Me(context.Context, string) (auth.CurrentUser, error) {
	return auth.GuestUser(), service.err
}

type routerCurrentUserResolver struct {
	err error
}

// ResolveCurrentUser implements the corresponding operation for the surrounding test double.
func (resolver routerCurrentUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return auth.GuestUser(), resolver.err
}

type recordingRouterCurrentUserResolver struct {
	calls int
}

// ResolveCurrentUser records each attempted session identity resolution.
func (resolver *recordingRouterCurrentUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	resolver.calls++
	return auth.GuestUser(), nil
}

type routerHealthChecker struct {
	calls int
	err   error
}

func (checker *routerHealthChecker) Ping(context.Context) error {
	checker.calls++
	return checker.err
}

type routerShortLinkService struct {
	err error
}

// Overview implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) Overview(context.Context, auth.CurrentUser) (shortlink.OverviewResult, error) {
	return shortlink.OverviewResult{}, service.err
}

// Create implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) Create(context.Context, auth.CurrentUser, shortlink.CreateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, service.err
}

// List implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) List(context.Context, auth.CurrentUser, shortlink.ListInput) (shortlink.ListResult, error) {
	return shortlink.ListResult{}, service.err
}

// Update implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) Update(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, service.err
}

// Delete implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) Delete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return service.err
}

// Statistics implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) Statistics(context.Context, auth.CurrentUser, shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	return shortlink.StatisticsResult{}, service.err
}

// AdminList implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) AdminList(context.Context, auth.CurrentUser, shortlink.ListInput) (shortlink.AdminListResult, error) {
	return shortlink.AdminListResult{}, service.err
}

// AdminStatistics implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) AdminStatistics(context.Context, auth.CurrentUser, shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	return shortlink.StatisticsResult{}, service.err
}

// AdminUpdate implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) AdminUpdate(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return shortlink.CreateResult{}, service.err
}

// AdminDelete implements the corresponding operation for the surrounding test double.
func (service routerShortLinkService) AdminDelete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return service.err
}

type routerRedirectService struct {
	err                  error
	openResult           shortlink.OpenResult
	openResultConfigured bool
	previewResult        shortlink.PreviewResult
	unlockResult         shortlink.AccessGrant
	continueResult       shortlink.RedirectResult
	openSlugs            []string
	previewSlugs         []string
	previewTokens        []string
	continueSlugs        []string
	continueToken        string
	unlockSlugs          []string
	unlockPassword       string
}

// int16Pointer returns a pointer to the supplied fixture value.
func int16Pointer(value int16) *int16 {
	return &value
}

// Open implements the corresponding operation for the surrounding test double.
func (service *routerRedirectService) Open(_ context.Context, slug string) (shortlink.OpenResult, error) {
	service.openSlugs = append(service.openSlugs, slug)
	if service.err != nil {
		return shortlink.OpenResult{}, service.err
	}
	if !service.openResultConfigured {
		return shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com"}}, nil
	}
	return service.openResult, nil
}

// Preview records the slug forwarded by router preview routes.
func (service *routerRedirectService) Preview(_ context.Context, slug string, accessToken string) (shortlink.PreviewResult, error) {
	service.previewSlugs = append(service.previewSlugs, slug)
	service.previewTokens = append(service.previewTokens, accessToken)
	if service.err != nil {
		return shortlink.PreviewResult{}, service.err
	}
	if service.previewResult.Slug == "" {
		return shortlink.PreviewResult{Slug: "abc123", TargetHost: "example.com", IntermediateDelaySeconds: int16Pointer(5)}, nil
	}
	return service.previewResult, nil
}

// Unlock satisfies the redirect contract for router tests that do not exercise password verification.
func (service *routerRedirectService) Unlock(_ context.Context, slug string, password string) (shortlink.AccessGrant, error) {
	service.unlockSlugs = append(service.unlockSlugs, slug)
	service.unlockPassword = password
	if service.err != nil {
		return shortlink.AccessGrant{}, service.err
	}
	return service.unlockResult, nil
}

// Continue records the slug forwarded by the fixed continue route.
func (service *routerRedirectService) Continue(_ context.Context, slug string, accessToken string) (shortlink.RedirectResult, error) {
	service.continueSlugs = append(service.continueSlugs, slug)
	service.continueToken = accessToken
	if service.err != nil {
		return shortlink.RedirectResult{}, service.err
	}
	if service.continueResult.TargetURL == "" {
		return shortlink.RedirectResult{TargetURL: "https://example.com"}, nil
	}
	return service.continueResult, nil
}

type routerUserService struct {
	err error
}

// Create implements the corresponding operation for the surrounding test double.
func (service routerUserService) Create(context.Context, auth.CurrentUser, user.CreateInput) (user.CreateResult, error) {
	return user.CreateResult{}, service.err
}

// List implements the corresponding operation for the surrounding test double.
func (service routerUserService) List(context.Context, auth.CurrentUser, user.ListInput) (user.ListResult, error) {
	return user.ListResult{}, service.err
}

// Update implements the corresponding operation for the surrounding test double.
func (service routerUserService) Update(context.Context, auth.CurrentUser, user.UpdateInput) (user.UpdateResult, error) {
	return user.UpdateResult{}, service.err
}

// UpdateProfile implements the corresponding operation for the surrounding test double.
func (service routerUserService) UpdateProfile(context.Context, auth.CurrentUser, user.UpdateProfileInput) (user.UpdateProfileResult, error) {
	return user.UpdateProfileResult{}, service.err
}

// ResetPassword implements the corresponding operation for the surrounding test double.
func (service routerUserService) ResetPassword(context.Context, auth.CurrentUser, user.ResetPasswordInput) error {
	return service.err
}

type routerUserGroupService struct {
	listCalls   int
	updateCalls int
}

type routerOIDCProviderService struct {
	methodCalls int
	listCalls   int
}

func (service *routerOIDCProviderService) Methods(context.Context) (oidc.LoginMethods, error) {
	service.methodCalls++
	return oidc.LoginMethods{}, nil
}

func (service *routerOIDCProviderService) List(context.Context, auth.CurrentUser) (oidc.ProviderList, error) {
	service.listCalls++
	return oidc.ProviderList{}, nil
}

func (*routerOIDCProviderService) Create(context.Context, auth.CurrentUser, oidc.CreateProviderInput) (oidc.ProviderResult, error) {
	return oidc.ProviderResult{}, nil
}

func (*routerOIDCProviderService) Update(context.Context, auth.CurrentUser, oidc.UpdateProviderInput) (oidc.ProviderResult, error) {
	return oidc.ProviderResult{}, nil
}

func (*routerOIDCProviderService) Delete(context.Context, auth.CurrentUser, oidc.DeleteProviderInput) (oidc.DeleteProviderResult, error) {
	return oidc.DeleteProviderResult{}, nil
}

type routerOIDCLoginService struct {
	startCalls int
}

func (service *routerOIDCLoginService) Start(context.Context, string, string) (oidc.LoginStart, error) {
	service.startCalls++
	return oidc.LoginStart{Location: "https://id.example.com/authorize"}, nil
}

// Callback returns a stable browser-login result for router integration tests.
func (*routerOIDCLoginService) Callback(context.Context, string, string, string, string) (oidc.LoginCallback, error) {
	return oidc.LoginCallback{}, oidc.ErrLoginFailed
}

// List records user-group list route dispatch.
func (service *routerUserGroupService) List(context.Context, auth.CurrentUser) (usergroup.ListResult, error) {
	service.listCalls++
	return usergroup.ListResult{}, nil
}

// UpdatePermissions records user-group update route dispatch.
func (service *routerUserGroupService) UpdatePermissions(context.Context, auth.CurrentUser, usergroup.UpdatePermissionsInput) (usergroup.UpdatePermissionsResult, error) {
	service.updateCalls++
	return usergroup.UpdatePermissionsResult{}, nil
}
