package user_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
)

func TestHandlerCreateUserReturnsCreatedUser(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions}},
		User: &fakeUserService{result: user.CreateResult{
			User: user.CreatedUser{ID: "user-id", Username: "alice", Nickname: "Alice", Group: "user", Status: "active"},
		}},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user/create", bytes.NewBufferString(`{
		"username": "alice",
		"password": "secure-password",
		"nickname": "Alice",
		"groupKey": "user",
		"status": "active"
	}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			User user.CreatedUser `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || body.Data.User.Username != "alice" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestHandlerCreateUserMapsBusinessErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
	}{
		{name: "permission", err: user.ErrPermissionDenied, code: 120001},
		{name: "duplicate", err: user.ErrUsernameExists, code: 300101},
		{name: "invalid", err: user.ErrInvalidInput, code: 100001},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				User:        &fakeUserService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user/create", bytes.NewBufferString(`{
				"username": "alice"
			}`))

			router.ServeHTTP(response, request)

			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != tt.code {
				t.Fatalf("expected code %d, got %d", tt.code, body.Code)
			}
		})
	}
}

type fakeUserService struct {
	result user.CreateResult
	err    error
}

func (f *fakeUserService) Create(context.Context, auth.CurrentUser, user.CreateInput) (user.CreateResult, error) {
	return f.result, f.err
}

type fakeCurrentUserResolver struct {
	user auth.CurrentUser
	err  error
}

func (f *fakeCurrentUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	if f.err != nil {
		return auth.GuestUser(), f.err
	}
	if f.user.Username == "" {
		return auth.GuestUser(), nil
	}
	return f.user, nil
}

var _ = errors.Is
