package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
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

// TestRedirectHandlerAnalyticsConstructorConfiguresHandler verifies analytics dependencies are retained and successful redirects are recorded.
func TestRedirectHandlerAnalyticsConstructorConfiguresHandler(t *testing.T) {
	recorder := &recordingRecorder{}
	handler := shortlink.NewRedirectHandlerWithAnalytics(
		&fakeRedirectService{openResult: shortlink.OpenResult{
			RedirectMode: shortlink.RedirectModeDirect,
			RedirectResult: shortlink.RedirectResult{
				TargetURL:   "https://example.com/target",
				ShortLinkID: "link-id",
			},
		}},
		recorder,
		"X-Country-Code",
	)
	response := httptest.NewRecorder()
	handler.Open(response, httptest.NewRequest(http.MethodGet, "/abc123", nil), "abc123")

	if response.Code != http.StatusFound {
		t.Fatalf("expected 302, got %d", response.Code)
	}
	assertEvents(t, recorder.types, []string{event.RedirectResponseSent})
}

// TestRedirectHandlerRedirectsProtectedSlugToPasswordPage verifies protected direct links enter the public password flow.
func TestRedirectHandlerRedirectsProtectedSlugToPasswordPage(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: shortlink.RedirectModeDirect, Slug: "abc123", RequiresPassword: true}},
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/abc123", nil))

	if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/abc123?reason=password" {
		t.Fatalf("expected password redirect, got %d %q", response.Code, response.Header().Get("Location"))
	}
}

// TestRedirectHandlerUnlockSetsScopedCookie verifies successful unlocks scope grants to the requested short link.
func TestRedirectHandlerUnlockSetsScopedCookie(t *testing.T) {
	grantExpiresAt := time.Now().Add(2 * time.Minute)
	service := &fakeRedirectService{unlockGrant: shortlink.AccessGrant{Token: "raw-token", ExpiresAt: grantExpiresAt}}
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: service,
	})
	request := httptest.NewRequest(http.MethodPost, "/go/AbC123/unlock", bytes.NewBufferString(`{"password":"correct horse"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", response.Code)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode unlock response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected successful unlock code, got %d", body.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one access cookie, got %d; response headers: %#v", len(cookies), response.Header())
	}
	cookie := cookies[0]
	if cookie.Name != "moeurl_short_link_access" || cookie.Value != "raw-token" || cookie.Path != "/go/abc123" || !cookie.HttpOnly || cookie.Secure || cookie.SameSite != http.SameSiteLaxMode || cookie.MaxAge < 899 || cookie.MaxAge > 900 {
		t.Fatalf("unexpected access cookie: %#v", cookie)
	}
	if service.unlockSlug != "abc123" {
		t.Fatalf("expected normalized unlock slug, got %q", service.unlockSlug)
	}
}

// TestRedirectHandlerUnlockSetsSecureCookie verifies production unlock grants require secure transport.
func TestRedirectHandlerUnlockSetsSecureCookie(t *testing.T) {
	handler := shortlink.NewRedirectHandlerWithAnalyticsAndSecurity(
		&fakeRedirectService{unlockGrant: shortlink.AccessGrant{Token: "raw-token", ExpiresAt: time.Now().Add(2 * time.Minute)}},
		&recordingRecorder{},
		"",
		true,
		slog.Default(),
	)
	request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString(`{"password":"correct horse"}`))
	response := httptest.NewRecorder()

	handler.Unlock(response, request, "abc123")

	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one access cookie, got %d", len(cookies))
	}
	if !cookies[0].Secure {
		t.Fatalf("expected secure access cookie, got %#v", cookies[0])
	}
}

// TestRedirectHandlerUnlockKeepsFixedCookieLifetime verifies cookie lifetime stays fixed until database checks reject a grant.
func TestRedirectHandlerUnlockKeepsFixedCookieLifetime(t *testing.T) {
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{
		unlockGrant: shortlink.AccessGrant{Token: "stale-token", ExpiresAt: time.Now().Add(-time.Second)},
	})
	request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString(`{"password":"correct horse"}`))
	response := httptest.NewRecorder()

	handler.Unlock(response, request, "abc123")

	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one access cookie, got %d", len(cookies))
	}
	if cookies[0].MaxAge < 899 || cookies[0].MaxAge > 900 {
		t.Fatalf("expected configured access cookie lifetime, got %#v", cookies[0])
	}
}

// TestRedirectHandlerUnlockRateLimitIncludesRetryAt verifies the backend deadline reaches the public API.
func TestRedirectHandlerUnlockRateLimitIncludesRetryAt(t *testing.T) {
	retryAt := time.Date(2026, time.August, 11, 12, 0, 0, 0, time.UTC)
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: &fakeRedirectService{
		unlockErr: &shortlink.PasswordRateLimitedError{RetryAt: retryAt},
	}})
	request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString(`{"password":"wrong"}`))
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Meta struct {
			RetryAt string `json:"retryAt"`
		} `json:"meta"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode rate-limit response: %v", err)
	}
	if body.Code != shortlink.CodePasswordRateLimited || body.Meta.RetryAt != retryAt.Format(time.RFC3339Nano) {
		t.Fatalf("expected rate-limit retry deadline, got code %d retryAt %q", body.Code, body.Meta.RetryAt)
	}
}

// TestRedirectHandlerUnlockMapsPasswordErrorsToBusinessCodes verifies public password failures retain the API error contract.
func TestRedirectHandlerUnlockMapsPasswordErrorsToBusinessCodes(t *testing.T) {
	for _, test := range []struct {
		name string
		err  error
		code int
	}{
		{name: "required", err: shortlink.ErrPasswordRequired, code: shortlink.CodePasswordRequired},
		{name: "invalid", err: shortlink.ErrInvalidPassword, code: shortlink.CodeInvalidPassword},
		{name: "missing", err: shortlink.ErrShortLinkMissing, code: shortlink.CodeInvalidPassword},
		{name: "disabled", err: shortlink.ErrShortLinkDisabled, code: shortlink.CodeInvalidPassword},
		{name: "expired", err: shortlink.ErrShortLinkExpired, code: shortlink.CodeInvalidPassword},
		{name: "rate limited", err: shortlink.ErrPasswordRateLimited, code: shortlink.CodePasswordRateLimited},
	} {
		t.Run(test.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{Redirect: &fakeRedirectService{unlockErr: test.err}})
			request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString(`{"password":"wrong"}`))
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			var body struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Code != http.StatusOK || body.Code != test.code {
				t.Fatalf("expected 200/code %d, got %d/code %d", test.code, response.Code, body.Code)
			}
		})
	}
}

// TestRedirectHandlerUnlockRejectsMalformedRequest verifies malformed unlock payloads are rejected before service execution.
func TestRedirectHandlerUnlockRejectsMalformedRequest(t *testing.T) {
	service := &fakeRedirectService{}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: service})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString("{"))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode malformed unlock response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("expected status 200 code 100001, got status %d code %d", response.Code, body.Code)
	}
	if service.unlockCalls != 0 {
		t.Fatalf("expected malformed request to stop before service call, got %d calls", service.unlockCalls)
	}
}

// TestRedirectHandlerCanonicalizesScopedSlugBeforeAuthorization verifies lowercase cookie paths are reached before token checks.
func TestRedirectHandlerCanonicalizesScopedSlugBeforeAuthorization(t *testing.T) {
	for _, test := range []struct {
		name     string
		path     string
		location string
		serve    func(*shortlink.RedirectHandler, http.ResponseWriter, *http.Request)
	}{
		{
			name:     "preview",
			path:     "/go/MiDdLe/preview?source=test",
			location: "/go/middle/preview?source=test",
			serve: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.PreviewScoped(response, request, "MiDdLe")
			},
		},
		{
			name:     "preview percent-encoded",
			path:     "/go/%4DiDdLe/preview?source=test",
			location: "/go/middle/preview?source=test",
			serve: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.PreviewScoped(response, request, "MiDdLe")
			},
		},
		{
			name:     "preview rebuilds fixed suffix",
			path:     "/go/MiDdLe/unexpected?source=test",
			location: "/go/middle/preview?source=test",
			serve: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.PreviewScoped(response, request, "MiDdLe")
			},
		},
		{
			name:     "continue",
			path:     "/go/MiDdLe/continue?source=test",
			location: "/go/middle/continue?source=test",
			serve: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.Continue(response, request, "MiDdLe")
			},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeRedirectService{}
			handler := shortlink.NewRedirectHandler(service)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, test.path, nil)
			request.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "uppercase-token"})
			response := httptest.NewRecorder()

			test.serve(handler, response, request)

			if response.Code != http.StatusFound || response.Header().Get("Location") != test.location {
				t.Fatalf("expected lowercase redirect to %q, got status %d location %q", test.location, response.Code, response.Header().Get("Location"))
			}
			if service.previewCalls != 0 || service.continueCalls != 0 {
				t.Fatalf("authorization service was called before lowercase redirect: preview=%d continue=%d", service.previewCalls, service.continueCalls)
			}
		})
	}
}

// TestRedirectHandlerUnlockRejectsOversizedRequest verifies the unlock body-size security boundary.
func TestRedirectHandlerUnlockRejectsOversizedRequest(t *testing.T) {
	service := &fakeRedirectService{}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: service})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/go/abc123/unlock",
		bytes.NewBufferString(`{"password":"`+strings.Repeat("a", 5<<10)+`"}`),
	)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode oversized unlock response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("expected status 200 code 100001, got status %d code %d", response.Code, body.Code)
	}
	if service.unlockCalls != 0 {
		t.Fatalf("expected oversized request to stop before service call, got %d calls", service.unlockCalls)
	}
}

// TestRedirectHandlerUnlockRejectsTrailingOversizedJSON verifies trailing input cannot bypass the body-size boundary.
func TestRedirectHandlerUnlockRejectsTrailingOversizedJSON(t *testing.T) {
	service := &fakeRedirectService{}
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: service})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(
		http.MethodPost,
		"/go/abc123/unlock",
		bytes.NewBufferString(`{"password":"correct horse"}`+strings.Repeat(" ", 5<<10)),
	)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode trailing oversized unlock response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != 100001 {
		t.Fatalf("expected status 200 code 100001, got status %d code %d", response.Code, body.Code)
	}
	if service.unlockCalls != 0 {
		t.Fatalf("expected trailing oversized request to stop before service call, got %d calls", service.unlockCalls)
	}
}

// TestRedirectHandlerUnlockMapsSystemError verifies infrastructure failures produce an HTTP 500 response.
func TestRedirectHandlerUnlockMapsSystemError(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Redirect: &fakeRedirectService{unlockErr: errors.New("database down")}})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/go/abc123/unlock", bytes.NewBufferString(`{"password":"correct horse"}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode system unlock response: %v", err)
	}
	if response.Code != http.StatusInternalServerError || body.Code != 900000 {
		t.Fatalf("expected status 500 code 900000, got status %d code %d", response.Code, body.Code)
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

// TestRedirectHandlerOpensInteractivePageWithoutSuccessEvent verifies both public pages stay internal and uncounted.
func TestRedirectHandlerOpensInteractivePageWithoutSuccessEvent(t *testing.T) {
	for _, mode := range []string{shortlink.RedirectModeIntermediate, shortlink.RedirectModeConfirmation} {
		t.Run(mode, func(t *testing.T) {
			recorder := &recordingRecorder{}
			handler := shortlink.NewRedirectHandler(
				&fakeRedirectService{openResult: shortlink.OpenResult{RedirectMode: mode, Slug: "middle"}},
				recorder,
			)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/middle", nil)

			handler.Open(response, request, "middle")

			if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/middle" {
				t.Fatalf("expected internal interactive redirect, got status %d location %q", response.Code, response.Header().Get("Location"))
			}
			if len(recorder.types) != 0 {
				t.Fatalf("expected no successful response event, got %#v", recorder.types)
			}
		})
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

// TestRedirectHandlerContinueWriteFailureDoesNotRecordSuccess verifies redirect handler continue write failure does not record success.
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

// TestRedirectHandlerPreviewUsesUnifiedMinimalResponse verifies authorized preview never leaks the target URL.
func TestRedirectHandlerPreviewUsesUnifiedMinimalResponse(t *testing.T) {
	expiresAt := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{previewResult: shortlink.PreviewResult{
		Slug:                     "middle",
		TargetHost:               "example.com",
		RedirectMode:             shortlink.RedirectModeIntermediate,
		IntermediateDelaySeconds: int16Pointer(7),
		ExpiresAt:                &expiresAt,
	}})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil)
	request.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "raw-token"})

	handler.PreviewPublic(response, request)

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
	if body.Code != 0 || body.Data.TargetHost != "example.com" || body.Data.RedirectMode != shortlink.RedirectModeIntermediate || body.Data.IntermediateDelaySeconds == nil || *body.Data.IntermediateDelaySeconds != 7 || body.Data.ExpiresAt == nil || !body.Data.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected preview body: %#v", body)
	}
	if !bytes.Contains(raw, []byte(`"redirectMode":"intermediate"`)) || bytes.Contains(raw, []byte("https://")) || bytes.Contains(raw, []byte("http://")) || bytes.Contains(raw, []byte("targetUrl")) {
		t.Fatalf("preview leaked target URL: %s", raw)
	}
}

// TestRedirectHandlerPreviewForwardsAccessCookie verifies both preview entry points revalidate scoped grants.
func TestRedirectHandlerPreviewForwardsAccessCookie(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		preview func(*shortlink.RedirectHandler, http.ResponseWriter, *http.Request)
	}{
		{
			name: "public",
			path: "/api/v1/public/short-link/preview?slug=middle",
			preview: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.PreviewPublic(response, request)
			},
		},
		{
			name: "scoped",
			path: "/go/middle/preview",
			preview: func(handler *shortlink.RedirectHandler, response http.ResponseWriter, request *http.Request) {
				handler.PreviewScoped(response, request, "middle")
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			service := &fakeRedirectService{previewResult: shortlink.PreviewResult{Slug: "middle", TargetHost: "example.com", IntermediateDelaySeconds: int16Pointer(5)}}
			handler := shortlink.NewRedirectHandler(service)
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.path, nil)
			request.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "raw-token"})

			tt.preview(handler, response, request)

			if response.Code != http.StatusOK || service.previewCalls != 1 || service.previewToken != "raw-token" {
				t.Fatalf("expected %s preview to forward access cookie, got status %d calls %d token %q", tt.name, response.Code, service.previewCalls, service.previewToken)
			}
		})
	}
}

// TestRedirectHandlerPreviewRejectsUnauthorizedProtectedPreview verifies redirect handler preview rejects unauthorized protected preview.
func TestRedirectHandlerPreviewRejectsUnauthorizedProtectedPreview(t *testing.T) {
	service := &fakeRedirectService{previewErr: shortlink.ErrPasswordRequired}
	handler := shortlink.NewRedirectHandler(service)
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/go/middle/preview", nil)

	handler.PreviewScoped(response, request, "middle")

	var body struct {
		Code int `json:"code"`
		Data any `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode unauthorized preview response: %v", err)
	}
	if response.Code != http.StatusOK || body.Code != shortlink.CodePasswordRequired || body.Data != nil {
		t.Fatalf("expected unauthorized preview response without data, got status %d code %d data %#v", response.Code, body.Code, body.Data)
	}
}

// TestRedirectHandlerAccessCookieIsIsolatedByShortLink verifies a grant for one slug is not sent to another slug path.
func TestRedirectHandlerAccessCookieIsIsolatedByShortLink(t *testing.T) {
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{
		unlockGrant: shortlink.AccessGrant{Token: "link-a-token", ExpiresAt: time.Now().Add(time.Minute)},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/go/link-a/unlock", bytes.NewBufferString(`{"password":"correct horse"}`))

	handler.Unlock(response, request, "link-a")

	cookies := response.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one access cookie, got %d", len(cookies))
	}
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatalf("create cookie jar: %v", err)
	}
	linkAURL := &url.URL{Scheme: "https", Host: "example.com", Path: "/go/link-a/preview"}
	linkBURL := &url.URL{Scheme: "https", Host: "example.com", Path: "/go/link-b/preview"}
	jar.SetCookies(linkAURL, cookies)
	if got := jar.Cookies(linkAURL); len(got) != 1 {
		t.Fatalf("expected link A path to receive one access cookie, got %d", len(got))
	}
	if got := jar.Cookies(linkBURL); len(got) != 0 {
		t.Fatalf("expected link B path to receive no access cookies, got %d", len(got))
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
		{name: "not interactive", err: shortlink.ErrShortLinkNotInteractive, httpStatus: http.StatusOK, code: shortlink.CodeShortLinkNotInteractive},
		{name: "password required", err: shortlink.ErrPasswordRequired, httpStatus: http.StatusOK, code: shortlink.CodePasswordRequired},
		{name: "system", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := shortlink.NewRedirectHandler(&fakeRedirectService{previewErr: tt.err})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/public/short-link/preview?slug=middle", nil)

			handler.PreviewPublic(response, request)

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

	handler.PreviewPublic(response, request)

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
		{name: "not interactive", err: shortlink.ErrShortLinkNotInteractive, code: http.StatusFound, location: "/go/middle?reason=not-interactive"},
		{name: "password required", err: shortlink.ErrPasswordRequired, code: http.StatusFound, location: "/go/middle?reason=password"},
		{name: "invalid password", err: shortlink.ErrInvalidPassword, code: http.StatusFound, location: "/go/middle?reason=password"},
		{name: "rate limited", err: shortlink.ErrPasswordRateLimited, code: http.StatusFound, location: "/go/middle?reason=rate-limited"},
		{name: "system", err: errors.New("database down"), code: http.StatusFound, location: "/go/middle?reason=continue-failed"},
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

// TestRedirectHandlerContinueLogsUnexpectedErrors verifies infrastructure failures retain their original cause in logs.
func TestRedirectHandlerContinueLogsUnexpectedErrors(t *testing.T) {
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	router := apphttp.NewRouter(apphttp.Dependencies{
		Redirect: &fakeRedirectService{continueErr: errors.New("database down")},
		Logger:   logger,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil)

	router.ServeHTTP(response, request)

	for _, field := range []string{"short_link_continue_failed", "slug=middle", "database down"} {
		if !strings.Contains(logOutput.String(), field) {
			t.Fatalf("expected continue failure log field %q, got %q", field, logOutput.String())
		}
	}
	if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/middle?reason=continue-failed" {
		t.Fatalf("expected continue-failed redirect, got status %d location %q", response.Code, response.Header().Get("Location"))
	}
}

// TestRedirectHandlerContinueIncludesRateLimitRetryAt verifies redirect handler continue includes rate limit retry at.
func TestRedirectHandlerContinueIncludesRateLimitRetryAt(t *testing.T) {
	retryAt := time.Date(2026, time.August, 11, 12, 0, 0, 0, time.UTC)
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{
		continueErr: &shortlink.PasswordRateLimitedError{RetryAt: retryAt},
	})
	response := httptest.NewRecorder()
	handler.Continue(response, httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil), "middle")

	want := "/go/middle?reason=rate-limited&retryAt=" + url.QueryEscape(retryAt.Format(time.RFC3339Nano))
	if response.Code != http.StatusFound || response.Header().Get("Location") != want {
		t.Fatalf("expected retry deadline redirect %q, got status %d location %q", want, response.Code, response.Header().Get("Location"))
	}
}

// TestRedirectHandlerContinuePassesScopedAccessCookie verifies continuation forwards the link-scoped access grant.
func TestRedirectHandlerContinuePassesScopedAccessCookie(t *testing.T) {
	service := &fakeRedirectService{continueResult: shortlink.RedirectResult{TargetURL: "https://example.com/final", ShortLinkID: "link-id"}}
	handler := shortlink.NewRedirectHandler(service)
	request := httptest.NewRequest(http.MethodGet, "/go/middle/continue", nil)
	request.AddCookie(&http.Cookie{Name: "moeurl_short_link_access", Value: "raw-token"})
	response := httptest.NewRecorder()

	handler.Continue(response, request, "middle")

	if service.continueToken != "raw-token" {
		t.Fatalf("expected scoped access token, got %q", service.continueToken)
	}
}

// TestRedirectHandlerOpenMapsNotInteractiveError verifies direct links cannot render an interactive page.
func TestRedirectHandlerOpenMapsNotInteractiveError(t *testing.T) {
	handler := shortlink.NewRedirectHandler(&fakeRedirectService{openErr: shortlink.ErrShortLinkNotInteractive})
	response := httptest.NewRecorder()

	handler.Open(response, httptest.NewRequest(http.MethodGet, "/abc123", nil), "abc123")

	if response.Code != http.StatusFound || response.Header().Get("Location") != "/go/abc123?reason=not-interactive" {
		t.Fatalf("expected not-interactive state, got status %d location %q", response.Code, response.Header().Get("Location"))
	}
}

type fakeRedirectService struct {
	openResult     shortlink.OpenResult
	previewResult  shortlink.PreviewResult
	continueResult shortlink.RedirectResult
	openErr        error
	previewErr     error
	continueErr    error
	unlockGrant    shortlink.AccessGrant
	unlockErr      error
	unlockCalls    int
	unlockSlug     string
	continueCalls  int
	previewCalls   int
	previewToken   string
	continueToken  string
}

// int16Pointer returns a pointer to the supplied fixture value.
func int16Pointer(value int16) *int16 {
	return &value
}

// Open returns the configured initial access result.
func (f *fakeRedirectService) Open(context.Context, string) (shortlink.OpenResult, error) {
	if f.openErr != nil {
		return shortlink.OpenResult{}, f.openErr
	}
	return f.openResult, nil
}

// Preview returns the configured public preview result.
func (f *fakeRedirectService) Preview(_ context.Context, _ string, accessToken string) (shortlink.PreviewResult, error) {
	f.previewCalls++
	f.previewToken = accessToken
	if f.previewErr != nil {
		return shortlink.PreviewResult{}, f.previewErr
	}
	return f.previewResult, nil
}

// Continue returns the configured final redirect result.
func (f *fakeRedirectService) Continue(_ context.Context, _ string, accessToken string) (shortlink.RedirectResult, error) {
	f.continueCalls++
	f.continueToken = accessToken
	if f.continueErr != nil {
		return shortlink.RedirectResult{}, f.continueErr
	}
	return f.continueResult, nil
}

// Unlock returns the configured public access grant result.
func (f *fakeRedirectService) Unlock(_ context.Context, slug string, _ string) (shortlink.AccessGrant, error) {
	f.unlockCalls++
	f.unlockSlug = slug
	if f.unlockErr != nil {
		return shortlink.AccessGrant{}, f.unlockErr
	}
	return f.unlockGrant, nil
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
