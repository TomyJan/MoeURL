package oidc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/go-chi/chi/v5"
)

// TestHandlerStartsOIDCLoginWithNoStoreRedirect verifies start responses are non-cacheable browser redirects.
func TestHandlerStartsOIDCLoginWithNoStoreRedirect(t *testing.T) {
	login := &loginPortStub{start: LoginStart{
		Location: "https://id.example.com/authorize", BrowserBinding: "browser-binding",
		BindingCookieName: "moeurl_oidc_attempt", ExpiresAt: time.Now().Add(loginAttemptTTL),
	}}
	handler := NewHandler(&providerPortStub{}, login, false, nil)
	router := chi.NewRouter()
	router.Get("/auth/oidc/{providerKey}/start", handler.Start)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/auth/oidc/company/start?returnTo=%2Fanalytics", nil))
	if response.Code != http.StatusFound || response.Header().Get("Location") != login.start.Location {
		t.Fatalf("start response = status %d location %q", response.Code, response.Header().Get("Location"))
	}
	if response.Header().Get("Cache-Control") != "no-store" || login.providerKey != "company" || login.returnPath != "/analytics" {
		t.Fatalf("start metadata = cache %q provider %q return %q", response.Header().Get("Cache-Control"), login.providerKey, login.returnPath)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != login.start.BindingCookieName || cookies[0].Value != login.start.BrowserBinding || cookies[0].Path != "/api/v1/auth/oidc/company/callback" || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteLaxMode {
		t.Fatalf("start cookies = %#v", cookies)
	}
}

// TestHandlerCompletesOIDCLoginWithSessionCookie verifies callback redirects only to the stored local path.
func TestHandlerCompletesOIDCLoginWithSessionCookie(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour)
	login := &loginPortStub{callback: LoginCallback{Session: auth.Session{ID: "session-id", ExpiresAt: expiresAt}, ReturnPath: "/console"}}
	handler := NewHandler(&providerPortStub{}, login, true, nil)
	router := chi.NewRouter()
	router.Get("/auth/oidc/{providerKey}/callback", handler.Callback)
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/auth/oidc/company/callback?code=secret-code&state=secret-state", nil)
	request.AddCookie(&http.Cookie{Name: browserBindingCookieName("secret-state"), Value: "browser-binding"})
	router.ServeHTTP(response, request)
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/console" {
		t.Fatalf("callback response = status %d location %q", response.Code, response.Header().Get("Location"))
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 2 || cookies[0].Name != browserBindingCookieName("secret-state") || cookies[0].MaxAge >= 0 || cookies[1].Name != auth.SessionCookieName || cookies[1].Value != "session-id" || !cookies[1].HttpOnly || !cookies[1].Secure || cookies[1].SameSite != http.SameSiteLaxMode {
		t.Fatalf("callback cookies = %#v", cookies)
	}
	if login.browserBinding != "browser-binding" {
		t.Fatalf("callback browser binding = %q", login.browserBinding)
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("callback Cache-Control = %q", response.Header().Get("Cache-Control"))
	}
}

// TestHandlerReturnsAuthenticationMethods verifies the public method projection and infrastructure response.
func TestHandlerReturnsAuthenticationMethods(t *testing.T) {
	providers := &providerPortStub{methods: LoginMethods{OIDC: []LoginProvider{{Key: "company", DisplayName: "Company SSO"}}}}
	providers.methods.Local.Enabled = true
	handler := NewHandler(providers, nil, false, nil)

	response := httptest.NewRecorder()
	handler.Methods(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/auth/methods", nil))
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "application/json; charset=utf-8" {
		t.Fatalf("methods response = status %d headers %#v", response.Code, response.Header())
	}
	var body handlerResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Code != 0 {
		t.Fatalf("methods body = %q err=%v", response.Body.String(), err)
	}

	providers.err = errors.New("database unavailable")
	response = httptest.NewRecorder()
	handler.Methods(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/auth/methods", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("failed methods status = %d", response.Code)
	}
}

// TestHandlerMapsBrowserLoginFailures verifies callback diagnostics remain bounded and secret-free.
func TestHandlerMapsBrowserLoginFailures(t *testing.T) {
	for _, test := range []struct {
		name     string
		err      error
		location string
	}{
		{name: "generic", err: errors.New("upstream included secret-code"), location: "/login?oidcError=login_failed"},
		{name: "identity", err: ErrIdentityNotAllowed, location: "/login?oidcError=identity_not_allowed"},
		{name: "disabled", err: ErrUserDisabled, location: "/login?oidcError=user_disabled"},
	} {
		t.Run(test.name, func(t *testing.T) {
			var logs bytes.Buffer
			login := &loginPortStub{callbackErr: test.err}
			handler := NewHandler(&providerPortStub{}, login, false, slog.New(slog.NewJSONHandler(&logs, nil)))
			router := chi.NewRouter()
			router.Get("/auth/oidc/{providerKey}/callback", handler.Callback)
			response := httptest.NewRecorder()
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/auth/oidc/company/callback?code=secret-code&state=secret-state", nil)
			request.AddCookie(&http.Cookie{Name: browserBindingCookieName("secret-state"), Value: "browser-binding"})
			router.ServeHTTP(response, request)

			if response.Code != http.StatusSeeOther || response.Header().Get("Location") != test.location {
				t.Fatalf("callback failure = status %d location %q", response.Code, response.Header().Get("Location"))
			}
			if strings.Contains(logs.String(), "secret-code") || strings.Contains(logs.String(), "secret-state") {
				t.Fatalf("callback log exposed query secret: %s", logs.String())
			}
			cookies := response.Result().Cookies()
			if len(cookies) != 1 || cookies[0].Name != browserBindingCookieName("secret-state") || cookies[0].MaxAge >= 0 {
				t.Fatalf("failed callback did not clear browser binding: %#v", cookies)
			}
		})
	}

	login := &loginPortStub{startErr: errors.New("provider unavailable")}
	handler := NewHandler(&providerPortStub{}, login, false, nil)
	router := chi.NewRouter()
	router.Get("/auth/oidc/{providerKey}/start", handler.Start)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/auth/oidc/company/start", nil))
	if response.Code != http.StatusSeeOther || response.Header().Get("Location") != "/login?oidcError=provider_unavailable" {
		t.Fatalf("start failure = status %d location %q", response.Code, response.Header().Get("Location"))
	}
}

// TestHandlerDecodesProviderManagementRequests verifies each management endpoint accepts one strict JSON object.
func TestHandlerDecodesProviderManagementRequests(t *testing.T) {
	providers := &providerPortStub{}
	handler := NewHandler(providers, nil, false, nil)
	tests := []struct {
		name  string
		path  string
		body  string
		call  string
		serve func(http.ResponseWriter, *http.Request)
	}{
		{name: "create", path: "/create", body: `{"key":"company","displayName":"Company","issuerUrl":"https://id.example.com","clientId":"client","clientSecret":"secret","allowedEmailDomains":["example.com"],"enabled":true}`, call: "create", serve: handler.Create},
		{name: "update", path: "/update", body: `{"id":"00000000-0000-0000-0000-000000000701","displayName":"Company","issuerUrl":"https://id.example.com","clientId":"client","clientSecret":{"mode":"preserve"},"allowedEmailDomains":["example.com"],"enabled":false,"expectedUpdatedAt":"2026-09-11T00:00:00Z"}`, call: "update", serve: handler.Update},
		{name: "delete", path: "/delete", body: `{"id":"00000000-0000-0000-0000-000000000701","expectedUpdatedAt":"2026-09-11T00:00:00Z"}`, call: "delete", serve: handler.Delete},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			providers.calls = nil
			response := httptest.NewRecorder()
			test.serve(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, test.path, strings.NewReader(test.body)))
			if response.Code != http.StatusOK || len(providers.calls) != 1 || providers.calls[0] != test.call {
				t.Fatalf("management response = status %d calls %#v body %q", response.Code, providers.calls, response.Body.String())
			}
		})
	}

	response := httptest.NewRecorder()
	handler.List(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/list", nil))
	if response.Code != http.StatusOK || providers.calls[len(providers.calls)-1] != "list" {
		t.Fatalf("list response = status %d calls %#v", response.Code, providers.calls)
	}

	callCount := len(providers.calls)
	response = httptest.NewRecorder()
	handler.Create(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/create", strings.NewReader(`{"key":"company"}{}`)))
	if response.Code != http.StatusOK || len(providers.calls) != callCount {
		t.Fatalf("invalid create response = status %d calls %#v body %q", response.Code, providers.calls, response.Body.String())
	}
	response = httptest.NewRecorder()
	handler.Update(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/update", strings.NewReader(`{"unknown":true}`)))
	response = httptest.NewRecorder()
	handler.Delete(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/delete", strings.NewReader(`[]`)))
	if len(providers.calls) != callCount {
		t.Fatalf("invalid management requests reached service: %#v", providers.calls)
	}
}

// TestHandlerMapsProviderErrors verifies stable API codes and infrastructure logging.
func TestHandlerMapsProviderErrors(t *testing.T) {
	for _, test := range []struct {
		err    error
		code   int
		status int
	}{
		{err: ErrInvalidInput, code: CodeInvalidRequest, status: http.StatusOK},
		{err: ErrPermissionDenied, code: CodePermissionDenied, status: http.StatusOK},
		{err: ErrProviderNotFound, code: CodeProviderNotFound, status: http.StatusOK},
		{err: ErrProviderConflict, code: CodeProviderConflict, status: http.StatusOK},
		{err: ErrProviderKeyExists, code: CodeProviderKeyExists, status: http.StatusOK},
		{err: ErrRuntimeUnavailable, code: CodeRuntimeUnavailable, status: http.StatusOK},
		{err: ErrDiscoveryUnavailable, code: CodeDiscoveryUnavailable, status: http.StatusOK},
		{err: errors.New("database secret diagnostic"), code: CodeInternalServerError, status: http.StatusInternalServerError},
	} {
		var logs bytes.Buffer
		handler := NewHandler(&providerPortStub{}, nil, false, slog.New(slog.NewJSONHandler(&logs, nil)))
		response := httptest.NewRecorder()
		handler.writeProviderResult(response, httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/provider", nil), "update", "company", nil, test.err)
		var body handlerResponse
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != test.status || body.Code != test.code {
			t.Fatalf("mapped error %v = status %d body %q decode=%v", test.err, response.Code, response.Body.String(), err)
		}
		if strings.Contains(logs.String(), "database secret diagnostic") {
			t.Fatalf("error log exposed diagnostic: %s", logs.String())
		}
	}
}

// TestHandlerFallsBackWhenJSONEncodingFails verifies response encoding never emits a partial success payload.
func TestHandlerFallsBackWhenJSONEncodingFails(t *testing.T) {
	handler := NewHandler(&providerPortStub{}, nil, false, nil)
	response := httptest.NewRecorder()
	handler.writeJSON(response, http.StatusOK, handlerResponse{Code: 0, Data: make(chan struct{})})
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":900000`) {
		t.Fatalf("encoding fallback = status %d body %q", response.Code, response.Body.String())
	}
}

type loginPortStub struct {
	start          LoginStart
	startErr       error
	callback       LoginCallback
	callbackErr    error
	providerKey    string
	returnPath     string
	browserBinding string
}

func (s *loginPortStub) Start(_ context.Context, providerKey string, returnPath string) (LoginStart, error) {
	s.providerKey, s.returnPath = providerKey, returnPath
	return s.start, s.startErr
}

// Callback captures the browser binding passed by the HTTP handler.
func (s *loginPortStub) Callback(_ context.Context, _ string, _ string, _ string, browserBinding string) (LoginCallback, error) {
	s.browserBinding = browserBinding
	return s.callback, s.callbackErr
}

type providerPortStub struct {
	methods LoginMethods
	err     error
	calls   []string
}

func (s *providerPortStub) Methods(context.Context) (LoginMethods, error) { return s.methods, s.err }
func (s *providerPortStub) List(context.Context, auth.CurrentUser) (ProviderList, error) {
	s.calls = append(s.calls, "list")
	return ProviderList{}, s.err
}
func (s *providerPortStub) Create(context.Context, auth.CurrentUser, CreateProviderInput) (ProviderResult, error) {
	s.calls = append(s.calls, "create")
	return ProviderResult{}, s.err
}
func (s *providerPortStub) Update(context.Context, auth.CurrentUser, UpdateProviderInput) (ProviderResult, error) {
	s.calls = append(s.calls, "update")
	return ProviderResult{}, s.err
}
func (s *providerPortStub) Delete(context.Context, auth.CurrentUser, DeleteProviderInput) (DeleteProviderResult, error) {
	s.calls = append(s.calls, "delete")
	return DeleteProviderResult{}, s.err
}
