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

type routerRedirectService struct{}

func (routerRedirectService) Resolve(context.Context, string) (shortlink.RedirectResult, error) {
	return shortlink.RedirectResult{TargetURL: "https://example.com"}, nil
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

func (routerUserService) ResetPassword(context.Context, auth.CurrentUser, user.ResetPasswordInput) error {
	return nil
}
