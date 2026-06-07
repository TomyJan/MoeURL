package auth_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
)

func TestAuthHandlerLoginSetsSessionCookie(t *testing.T) {
	t.Setenv("MOEURL_ENV", "production")
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
}

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

func TestAuthHandlerLogoutClearsCookie(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		Auth: &fakeAuthService{},
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
}

type fakeAuthService struct {
	loginResult auth.LoginResult
	loginErr    error
}

func (f *fakeAuthService) Login(context.Context, auth.LoginInput) (auth.LoginResult, error) {
	return f.loginResult, f.loginErr
}

func (f *fakeAuthService) Logout(context.Context, string) error {
	return nil
}

func (f *fakeAuthService) Me(context.Context, string) (auth.CurrentUser, error) {
	if f.loginResult.User.Username == "" {
		return auth.GuestUser(), nil
	}
	return f.loginResult.User, nil
}
