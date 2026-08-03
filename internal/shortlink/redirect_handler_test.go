package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/event"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

// TestRedirectHandlerRedirectsActiveSlug verifies active short links return a 302 response.
func TestRedirectHandlerRedirectsActiveSlug(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}}},
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
		&fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}}},
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
		&fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target", ShortLinkID: "link-id"}}},
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
		Redirect:  &fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target"}}},
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
		Redirect:  &fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target"}}},
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
		Redirect: &fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, RedirectResult: shortlink.RedirectResult{TargetURL: "https://example.com/target"}}},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/health", nil)

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected API route to win, got %d", response.Code)
	}
}

// TestRedirectHandlerShowsBlockedStatus verifies blocked links use localized public states.
func TestRedirectHandlerShowsBlockedStatus(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		code     int
		location string
	}{
		{name: "missing", err: shortlink.ErrShortLinkMissing, code: http.StatusNotFound},
		{name: "disabled", err: shortlink.ErrShortLinkDisabled, code: http.StatusFound, location: "/go/abc123?reason=disabled"},
		{name: "expired", err: shortlink.ErrShortLinkExpired, code: http.StatusFound, location: "/go/abc123?reason=expired"},
		{name: "system", err: errors.New("database down"), code: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				Redirect: &fakeRedirectService{openErr: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/abc123", nil)

			router.ServeHTTP(response, request)

			if response.Code != tt.code {
				t.Fatalf("expected %d, got %d", tt.code, response.Code)
			}
			if response.Header().Get("Location") != tt.location {
				t.Fatalf("expected redirect location %q, got %q", tt.location, response.Header().Get("Location"))
			}
		})
	}
}

// TestRedirectHandlerOpensIntermediatePageWithoutSuccessEvent verifies initial opens stay internal and uncounted.
func TestRedirectHandlerOpensIntermediatePageWithoutSuccessEvent(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandler(
		&fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeIntermediate, Slug: "middle"}},
		recorder,
	)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/middle", nil)

	handler.Open(response, request, "middle")

	if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/middle" {
		t.Fatalf("expected internal intermediate redirect, got status %d location %q", response.Code, response.Header().Get("Location"))
	}
	if len(recorder.types) != 0 {
		t.Fatalf("expected no successful response event, got %#v", recorder.types)
	}
}

// TestRedirectHandlerContinuesToTargetAndRecordsSuccess verifies only the final external response is counted.
func TestRedirectHandlerContinuesToTargetAndRecordsSuccess(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandler(
		&fakeRedirectService{continueResult: shortlink.RedirectResult{TargetURL: "https://example.com/final", ShortLinkID: "link-id"}},
		recorder,
	)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil)

	handler.Continue(response, request, "middle")

	if response.Code != http.StatusFound || response.Header().Get("Location") != "https://example.com/final" {
		t.Fatalf("expected final redirect, got status %d location %q", response.Code, response.Header().Get("Location"))
	}
	assertEvents(t, recorder.types, []string{event.RedirectResponseSent})
}

func TestRedirectHandlerContinueWriteFailureDoesNotRecordSuccess(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandler(
		&fakeRedirectService{continueResult: shortlink.RedirectResult{TargetURL: "https://example.com/final", ShortLinkID: "link-id"}},
		recorder,
	)
	request := httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil)
	response := &failingRedirectWriter{header: http.Header{}}

	handler.Continue(response, request, "middle")

	if len(recorder.types) != 0 {
		t.Fatalf("expected no events after failed final redirect write, got %#v", recorder.types)
	}
}

// TestRedirectHandlerPreviewUsesUnifiedMinimalResponse verifies public preview never leaks the target URL.
func TestRedirectHandlerPreviewUsesUnifiedMinimalResponse(t *testing.T) {
	expiresAt := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{previewResult: shortlink.PreviewResult{
		Slug:                     "middle",
		TargetHost:               "example.com",
		IntermediateDelaySeconds: 7,
		ExpiresAt:                &expiresAt,
	}})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil)

	handler.Preview(response, request)

	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("unexpected preview response status %d content type %q", response.Code, response.Header().Get("Content-Type"))
	}
	raw := append([]byte(nil), response.Body.Bytes()...)
	var body struct {
		Code int                     `json:"code"`
		Data shortlink.PreviewResult `json:"data"`
	}
	if err := json.NewDecoder(bytes.NewReader(raw)).Decode(&body); err != nil {
		t.Fatalf("decode preview response: %v", err)
	}
	if body.Code != 0 || body.Data.TargetHost != "example.com" || body.Data.IntermediateDelaySeconds != 7 || body.Data.ExpiresAt == nil || !body.Data.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected preview body: %#v", body)
	}
	if bytes.Contains(raw, []byte("https://example.com/final")) || bytes.Contains(raw, []byte("targetUrl")) {
		t.Fatalf("preview leaked target URL: %s", raw)
	}
}

// TestRedirectHandlerPreviewMapsBusinessAndSystemErrors verifies stable public API error handling.
func TestRedirectHandlerPreviewMapsBusinessAndSystemErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "missing", err: shortlink.ErrShortLinkMissing, httpStatus: http.StatusOK, code: shortlink.CodeShortLinkMissing},
		{name: "disabled", err: shortlink.ErrShortLinkDisabled, httpStatus: http.StatusOK, code: shortlink.CodeShortLinkDisabled},
		{name: "expired", err: shortlink.ErrShortLinkExpired, httpStatus: http.StatusOK, code: shortlink.CodeShortLinkExpired},
		{name: "not intermediate", err: shortlink.ErrShortLinkNotIntermediate, httpStatus: http.StatusOK, code: shortlink.CodeShortLinkNotIntermediate},
		{name: "system", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := shortlink.NewRedirectHandler(&fakeRedirectService{previewErr: tt.err})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil)

			handler.Preview(response, request)

			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode preview error: %v", err)
			}
			if response.Code != tt.httpStatus || body.Code != tt.code {
				t.Fatalf("expected status %d code %d, got status %d code %d", tt.httpStatus, tt.code, response.Code, body.Code)
			}
		})
	}
}

// TestRedirectHandlerPreviewRejectsMissingSlug verifies malformed public requests use the common invalid-request code.
func TestRedirectHandlerPreviewRejectsMissingSlug(t *testing.T) {
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/short-link/preview", nil)

	handler.Preview(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode invalid preview request: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("expected status 200 code 100001, got status %d code %d", response.Code, body.Code)
	}
}

// TestRedirectHandlerContinueShowsLifecycleErrors verifies final redirect rejections stay browser-readable.
func TestRedirectHandlerContinueShowsLifecycleErrors(t *testing.T) {
	tests := []struct {
		name     string
		err      error
		code     int
		location string
	}{
		{name: "missing", err: shortlink.ErrShortLinkMissing, code: http.StatusNotFound},
		{name: "disabled", err: shortlink.ErrShortLinkDisabled, code: http.StatusFound, location: "/go/middle?reason=disabled"},
		{name: "expired", err: shortlink.ErrShortLinkExpired, code: http.StatusFound, location: "/go/middle?reason=expired"},
		{name: "not intermediate", err: shortlink.ErrShortLinkNotIntermediate, code: http.StatusFound, location: "/go/middle?reason=not-intermediate"},
		{name: "system", err: errors.New("database down"), code: http.StatusInternalServerError},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := shortlink.NewRedirectHandler(&fakeRedirectService{continueErr: tt.err})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil)

			handler.Continue(response, request, "middle")

			if response.Code != tt.code || response.Header().Get("Location") != tt.location {
				t.Fatalf("expected status %d location %q, got %d location %q", tt.code, tt.location, response.Code, response.Header().Get("Location"))
			}
		})
	}
}

type fakeRedirectService struct {
	openResult     shortlink.OpenResult
	previewResult  shortlink.PreviewResult
	continueResult shortlink.RedirectResult
	openErr        error
	previewErr     error
	continueErr    error
}

// Open returns the configured initial access result.
func (f *fakeRedirectService) Open(context.Context, string) (shortlink.OpenResult, error) {
	if f.openErr != nil {
		return shortlink.OpenResult{}, f.openErr
	}
	return f.openResult, nil
}

// Preview returns the configured public preview result.
func (f *fakeRedirectService) Preview(context.Context, string) (shortlink.PreviewResult, error) {
	if f.previewErr != nil {
		return shortlink.PreviewResult{}, f.previewErr
	}
	return f.previewResult, nil
}

// Continue returns the configured final redirect result.
func (f *fakeRedirectService) Continue(context.Context, string) (shortlink.RedirectResult, error) {
	if f.continueErr != nil {
		return shortlink.RedirectResult{}, f.continueErr
	}
	return f.continueResult, nil
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
