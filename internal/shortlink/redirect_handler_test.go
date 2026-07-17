package shortlink_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/TomyJan/MoeURL/internal/event"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

// TestRedirectHandlerRedirectsActiveSlug verifies active short links return a 302 response.
func TestRedirectHandlerRedirectsActiveSlug(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}},
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

// TestRedirectHandlerRecordsSuccessfulRedirectResponse verifies successful responses emit an event.
func TestRedirectHandlerRecordsSuccessfulRedirectResponse(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandler(
		&fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}},
		recorder,
	)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/abc123", nil)

	handler.Open(response, request, "abc123")

	if response.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", response.Code)
	}
	assertEvents(t, recorder.types, []string{event.RedirectResponseSent})
	if len(recorder.ids) != 1 || recorder.ids[0] != "link-id" {
		t.Fatalf("expected response event with short link id, got %#v", recorder.ids)
	}
}

// TestRedirectHandlerSkipsSuccessfulEventWhenResponseWriteFails verifies failed writes are not counted.
func TestRedirectHandlerSkipsSuccessfulEventWhenResponseWriteFails(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandler(
		&fakeRedirectService{result: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}},
		recorder,
	)
	request := httptest.NewRequest(http.MethodGet, "/abc123", nil)

	handler.Open(&failingRedirectWriter{header: http.Header{}}, request, "abc123")

	if len(recorder.types) != 0 {
		t.Fatalf("expected no events when response write fails, got %#v", recorder.types)
	}
}

// TestRedirectHandlerDoesNotOverrideStaticFixedRoutes verifies fixed SPA routes win over slugs.
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

// TestRedirectHandlerDoesNotOverrideStaticAssetRoutes verifies static assets win over slugs.
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

// TestRedirectHandlerDoesNotOverrideFixedRoutes verifies API routes win over slug redirects.
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

// TestRedirectHandlerShowsBlockedStatus verifies disabled links do not redirect.
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

// Resolve returns the configured result for redirect handler tests.
func (f *fakeRedirectService) Resolve(context.Context, string) (shortlink.RedirectResult, error) {
	if f.err != nil {
		return shortlink.RedirectResult{}, f.err
	}
	return f.result, nil
}

var _ = errors.Is

type failingRedirectWriter struct {
	header http.Header
	code   int
}

// Header returns the response headers used by the failing test writer.
func (w *failingRedirectWriter) Header() http.Header {
	return w.header
}

// WriteHeader records the status written by the failing test writer.
func (w *failingRedirectWriter) WriteHeader(code int) {
	w.code = code
}

// Write always fails to simulate a redirect response write error.
func (w *failingRedirectWriter) Write([]byte) (int, error) {
	return 0, errors.New("write failed")
}
