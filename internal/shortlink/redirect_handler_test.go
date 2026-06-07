package shortlink_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

func TestRedirectHandlerRedirectsActiveSlug(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target"}},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/abc123", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", response.Code)
	}
	if response.Header().Get("Location") != "https://example.com/target" {
		t.Fatalf("unexpected location %q", response.Header().Get("Location"))
	}
}

func TestRedirectHandlerDoesNotOverrideStaticFixedRoutes(t *testing.T) {
	staticDir := t.TempDir()
	err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<!doctype html><title>MoeURL</title>"), 0o644)
	if err != nil {
		t.Fatalf("write index: %v", err)
	}
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect:  &fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target"}},
		StaticDir: staticDir,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/login", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected static route to win, got %d", response.Code)
	}
	if response.Header().Get("Location") != "" {
		t.Fatalf("expected no redirect location, got %q", response.Header().Get("Location"))
	}
}

func TestRedirectHandlerDoesNotOverrideStaticAssetRoutes(t *testing.T) {
	staticDir := t.TempDir()
	err := os.WriteFile(filepath.Join(staticDir, "manifest.webmanifest"), []byte(`{"name":"MoeURL"}`), 0o644)
	if err != nil {
		t.Fatalf("write manifest: %v", err)
	}
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect:  &fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target"}},
		StaticDir: staticDir,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected static manifest route to win, got %d", response.Code)
	}
	if response.Header().Get("Location") != "" {
		t.Fatalf("expected no redirect location, got %q", response.Header().Get("Location"))
	}
}

func TestRedirectHandlerDoesNotOverrideFixedRoutes(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target"}},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected API route to win, got %d", response.Code)
	}
}

func TestRedirectHandlerShowsBlockedStatus(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
	}{
		{name: "missing", err: shortlink.ErrShortLinkMissing, code: http.StatusNotFound},
		{name: "disabled", err: shortlink.ErrShortLinkDisabled, code: http.StatusOK},
		{name: "system", err: errors.New("database down"), code: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				Redirect: &fakeRedirectService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/abc123", nil)

			router.ServeHTTP(response, request)

			if response.Code != tt.code {
				t.Fatalf("expected %d, got %d", tt.code, response.Code)
			}
			if response.Header().Get("Location") != "" {
				t.Fatalf("expected no redirect location, got %q", response.Header().Get("Location"))
			}
		})
	}
}

type fakeRedirectService struct {
	result shortlink.RedirectResult
	err    error
}

func (f *fakeRedirectService) Resolve(context.Context, string) (shortlink.RedirectResult, error) {
	if f.err != nil {
		return shortlink.RedirectResult{}, f.err
	}
	return f.result, nil
}

var _ = errors.Is
