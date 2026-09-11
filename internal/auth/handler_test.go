package auth_test

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
	apphttp "github.com/TomyJan/MoeURL/internal/http"
)

// TestAuthHandlerLoginSetsSessionCookie verifies auth handler login sets session cookie.
func TestAuthHandlerLoginSetsSessionCookie(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth: &fakeAuthService{
			loginResult: auth.LoginResult{
				User: auth.CurrentUser{
					ID:          "user-id",
					Username:    "alice",
					Nickname:    "Alice",
					GroupKey:    "user",
					Permissions: []string{"short_link:create"},
				},
				Session: auth.Session{
					ID:        "session-id",
					UserID:    "user-id",
					ExpiresAt: time.Now().Add(time.Hour),
				},
			},
		},
		SecureCookies: true,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{
		"username": "alice",
		"password": "correct-password"
	}`))

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}
	cookie := response.Result().Cookies()[0]
	if cookie.Name != auth.SessionCookieName {
		t.Fatalf("expected session cookie, got %s", cookie.Name)
	}
	if !cookie.HttpOnly {
		t.Fatal("expected HttpOnly cookie")
	}
	if cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("expected SameSite=Lax, got %v", cookie.SameSite)
	}
	if !cookie.Secure {
		t.Fatal("expected Secure cookie in production")
	}

	var body struct {
		Code int `json:"code"`
		Data struct {
			User struct {
				ID          string   `json:"id"`
				Username    string   `json:"username"`
				Nickname    string   `json:"nickname"`
				Group       string   `json:"group"`
				Permissions []string `json:"permissions"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if body.Data.User.Username != "alice" {
		t.Fatalf("expected alice, got %s", body.Data.User.Username)
	}
	if body.Data.User.Group != "user" {
		t.Fatalf("expected group user, got %s", body.Data.User.Group)
	}
}

// TestAuthHandlerLoginMapsInvalidCredentials verifies auth handler login maps invalid credentials.
func TestAuthHandlerLoginMapsInvalidCredentials(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth: &fakeAuthService{loginErr: auth.ErrInvalidCredentials},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{
		"username": "alice",
		"password": "wrong-password"
	}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 110101 {
		t.Fatalf("expected code 110101, got %d", body.Code)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("invalid credentials set %d cookies", len(cookies))
	}
}

// TestAuthHandlerLoginMapsRateLimitDisabledAndSystemErrors verifies login failures keep stable HTTP and cookie semantics.
func TestAuthHandlerLoginMapsRateLimitDisabledAndSystemErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		httpStatus int
		code       int
		message    string
	}{
		{name: "rate limited", err: auth.ErrLoginRateLimited, httpStatus: http.StatusOK, code: 110103, message: "Login temporarily unavailable"},
		{name: "disabled", err: auth.ErrUserDisabled, httpStatus: http.StatusOK, code: 110102, message: "User disabled"},
		{name: "system", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000, message: "Internal server error"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				Auth: &fakeAuthService{loginErr: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{
				"username": "alice",
				"password": "password"
			}`))

			router.ServeHTTP(response, request)

			if response.Code != tt.httpStatus {
				t.Fatalf("expected http %d, got %d", tt.httpStatus, response.Code)
			}
			var body struct {
				Code    int    `json:"code"`
				Message string `json:"message"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != tt.code {
				t.Fatalf("expected code %d, got %d", tt.code, body.Code)
			}
			if body.Message != tt.message {
				t.Fatalf("expected message %q, got %q", tt.message, body.Message)
			}
			if cookies := response.Result().Cookies(); len(cookies) != 0 {
				t.Fatalf("%s failure set %d cookies", tt.name, len(cookies))
			}
		})
	}
}

// TestAuthHandlerLoginRejectsInvalidJSON verifies auth handler login rejects invalid json.
func TestAuthHandlerLoginRejectsInvalidJSON(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{Auth: &fakeAuthService{}})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 100001 {
		t.Fatalf("expected code 100001, got %d", body.Code)
	}
}

// TestAuthHandlerMeReturnsGuestWithoutSession verifies auth handler me returns guest without session.
func TestAuthHandlerMeReturnsGuestWithoutSession(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth: &fakeAuthService{},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/me", nil)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			User struct {
				Username string `json:"username"`
				Group    string `json:"group"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if body.Data.User.Username != "guest" {
		t.Fatalf("expected guest, got %s", body.Data.User.Username)
	}
	if body.Data.User.Group != "guest" {
		t.Fatalf("expected guest group, got %s", body.Data.User.Group)
	}
}

// TestAuthHandlerMeUsesSessionCookieAndFallsBackOnError verifies auth handler me uses session cookie and falls back on error.
func TestAuthHandlerMeUsesSessionCookieAndFallsBackOnError(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth: &fakeAuthService{
			loginErr: auth.ErrInvalidSession,
		},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/v1/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			User struct {
				Username string `json:"username"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Data.User.Username != "guest" {
		t.Fatalf("expected guest fallback, got %s", body.Data.User.Username)
	}
}

// TestAuthHandlerDefaultConstructorAndMeInfrastructureFailure verifies safe logger fallback and sanitized failure handling.
func TestAuthHandlerDefaultConstructorAndMeInfrastructureFailure(t *testing.T) {
	serviceErr := errors.New("database down")
	handler := auth.NewHandler(&fakeAuthService{loginErr: serviceErr}, false)
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/auth/me", nil)

	handler.Me(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	if strings.Contains(response.Body.String(), serviceErr.Error()) {
		t.Fatalf("response exposed service error: %q", response.Body.String())
	}
}

// TestAuthHandlerLogoutClearsCookie verifies auth handler logout clears cookie.
func TestAuthHandlerLogoutClearsCookie(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth:          &fakeAuthService{},
		SecureCookies: true,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/v1/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	router.ServeHTTP(response, request)

	cookie := response.Result().Cookies()[0]
	if cookie.Name != auth.SessionCookieName {
		t.Fatalf("expected session cookie, got %s", cookie.Name)
	}
	if cookie.MaxAge != -1 {
		t.Fatalf("expected clearing cookie max age -1, got %d", cookie.MaxAge)
	}
	if !cookie.Secure {
		t.Fatal("expected Secure clearing cookie in production")
	}
}

// TestAuthHandlerLogoutReportsRevocationFailure verifies logout does not discard the only cookie that can retry a failed revocation.
func TestAuthHandlerLogoutReportsRevocationFailure(t *testing.T) {
	var logs bytes.Buffer
	serviceErr := errors.New("session store unavailable")
	router := apphttp.NewRouter(apphttp.Dependencies{
		Logger: slog.New(slog.NewTextHandler(&logs, nil)),
		Auth:   &fakeAuthService{logoutErr: serviceErr},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/logout", nil)
	request.Header.Set("X-Request-ID", "logout-request")
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	router.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 0 {
		t.Fatalf("failed logout changed %d cookies", len(cookies))
	}
	for _, expected := range []string{"msg=auth_request_failed", "operation=logout", "request_id=logout-request", serviceErr.Error()} {
		if !strings.Contains(logs.String(), expected) {
			t.Fatalf("log missing %q: %q", expected, logs.String())
		}
	}
}

type fakeAuthService struct {
	loginResult auth.LoginResult
	loginErr    error
	logoutErr   error
}

// Login implements the corresponding operation for the surrounding test double.
func (f *fakeAuthService) Login(context.Context, auth.LoginInput) (auth.LoginResult, error) {
	return f.loginResult, f.loginErr
}

// Logout implements the corresponding operation for the surrounding test double.
func (f *fakeAuthService) Logout(context.Context, string) error {
	return f.logoutErr
}

// Me implements the corresponding operation for the surrounding test double.
func (f *fakeAuthService) Me(context.Context, string) (auth.CurrentUser, error) {
	if f.loginErr != nil {
		return auth.GuestUser(), f.loginErr
	}
	if f.loginResult.User.Username == "" {
		return auth.GuestUser(), nil
	}
	return f.loginResult.User, nil
}
