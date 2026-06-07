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

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}

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

			if response.Code != http.StatusOK {
				t.Fatalf("expected http 200, got %d", response.Code)
			}

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

func TestHandlerCreateUserRejectsInvalidJSONAndMapsSystemError(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "invalid json", body: `{`, httpStatus: http.StatusOK, code: 100001},
		{name: "system", body: `{"username":"alice"}`, err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				User:        &fakeUserService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user/create", bytes.NewBufferString(tt.body))

			router.ServeHTTP(response, request)

			if response.Code != tt.httpStatus {
				t.Fatalf("expected http %d, got %d", tt.httpStatus, response.Code)
			}
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

func TestHandlerListUsersReturnsItemsAndMeta(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions}},
		User: &fakeUserService{listResult: user.ListResult{
			Items: []user.UserSummary{{ID: "user-id", Username: "alice", Nickname: "Alice", Group: "user", Status: "active"}},
			Page:  2, PageSize: 10, Total: 21,
		}},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/user/list?page=2&pageSize=10", nil)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			Items []user.UserSummary `json:"items"`
		} `json:"data"`
		Meta struct {
			Page     int32 `json:"page"`
			PageSize int32 `json:"pageSize"`
			Total    int64 `json:"total"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || len(body.Data.Items) != 1 || body.Data.Items[0].Username != "alice" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if body.Meta.Page != 2 || body.Meta.PageSize != 10 || body.Meta.Total != 21 {
		t.Fatalf("unexpected meta: %#v", body.Meta)
	}
}

func TestHandlerListUsersUsesDefaultPaginationForInvalidQuery(t *testing.T) {
	service := &fakeUserService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions}},
		User:        service,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/user/list?page=bad&pageSize=bad", nil)

	router.ServeHTTP(response, request)

	if service.listInput.Page != 1 || service.listInput.PageSize != 20 {
		t.Fatalf("unexpected default pagination: %#v", service.listInput)
	}
}

func TestHandlerUpdateUserAndResetPassword(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions}},
		User: &fakeUserService{updateResult: user.UpdateResult{
			User: user.UserSummary{ID: "user-id", Username: "alice", Nickname: "Alice Renamed", Group: "user", Status: "disabled"},
		}},
	})

	updateResponse := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user/update", bytes.NewBufferString(`{
		"id": "user-id",
		"nickname": "Alice Renamed",
		"status": "disabled"
	}`))
	router.ServeHTTP(updateResponse, updateRequest)
	var updateBody struct {
		Code int `json:"code"`
		Data struct {
			User user.UserSummary `json:"user"`
		} `json:"data"`
	}
	if err := json.NewDecoder(updateResponse.Body).Decode(&updateBody); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updateBody.Code != 0 || updateBody.Data.User.Status != "disabled" {
		t.Fatalf("unexpected update body: %#v", updateBody)
	}

	resetResponse := httptest.NewRecorder()
	resetRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user/reset-password", bytes.NewBufferString(`{
		"id": "user-id",
		"password": "new-password"
	}`))
	router.ServeHTTP(resetResponse, resetRequest)
	var resetBody struct {
		Code int `json:"code"`
		Data struct {
			Reset bool `json:"reset"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resetResponse.Body).Decode(&resetBody); err != nil {
		t.Fatalf("decode reset response: %v", err)
	}
	if resetBody.Code != 0 || !resetBody.Data.Reset {
		t.Fatalf("unexpected reset body: %#v", resetBody)
	}
}

func TestHandlerUpdateAndResetRejectInvalidJSON(t *testing.T) {
	tests := []struct {
		name string
		path string
	}{
		{name: "update", path: "/api/v1/admin/user/update"},
		{name: "reset", path: "/api/v1/admin/user/reset-password"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				User:        &fakeUserService{},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, tt.path, bytes.NewBufferString(`{`))

			router.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("expected http 200, got %d", response.Code)
			}
			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if body.Code != 100001 {
				t.Fatalf("expected code 100001, got %d", body.Code)
			}
		})
	}
}

func TestHandlerUserManagementMapsErrors(t *testing.T) {
	tests := []struct {
		name       string
		method     string
		path       string
		body       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "list permission", method: http.MethodGet, path: "/api/v1/admin/user/list", err: user.ErrPermissionDenied, httpStatus: http.StatusOK, code: 120001},
		{name: "update immutable", method: http.MethodPost, path: "/api/v1/admin/user/update", body: `{"id":"guest","nickname":"Guest","status":"disabled"}`, err: user.ErrBuiltinUserImmutable, httpStatus: http.StatusOK, code: 300102},
		{name: "update not found", method: http.MethodPost, path: "/api/v1/admin/user/update", body: `{"id":"missing","nickname":"Missing","status":"disabled"}`, err: user.ErrUserNotFound, httpStatus: http.StatusOK, code: 300103},
		{name: "reset invalid", method: http.MethodPost, path: "/api/v1/admin/user/reset-password", body: `{"id":"user-id"}`, err: user.ErrInvalidInput, httpStatus: http.StatusOK, code: 100001},
		{name: "reset system", method: http.MethodPost, path: "/api/v1/admin/user/reset-password", body: `{"id":"user-id","password":"new-password"}`, err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
		{name: "update duplicate", method: http.MethodPost, path: "/api/v1/admin/user/update", body: `{"id":"user-id","nickname":"Alice","status":"active"}`, err: user.ErrUsernameExists, httpStatus: http.StatusOK, code: 300101},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				User:        &fakeUserService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(tt.method, tt.path, bytes.NewBufferString(tt.body))

			router.ServeHTTP(response, request)

			if response.Code != tt.httpStatus {
				t.Fatalf("expected http %d, got %d body %q", tt.httpStatus, response.Code, response.Body.String())
			}
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
	result       user.CreateResult
	listResult   user.ListResult
	listInput    user.ListInput
	updateResult user.UpdateResult
	err          error
}

func (f *fakeUserService) Create(context.Context, auth.CurrentUser, user.CreateInput) (user.CreateResult, error) {
	return f.result, f.err
}

func (f *fakeUserService) List(_ context.Context, _ auth.CurrentUser, input user.ListInput) (user.ListResult, error) {
	f.listInput = input
	return f.listResult, f.err
}

func (f *fakeUserService) Update(context.Context, auth.CurrentUser, user.UpdateInput) (user.UpdateResult, error) {
	return f.updateResult, f.err
}

func (f *fakeUserService) ResetPassword(context.Context, auth.CurrentUser, user.ResetPasswordInput) error {
	return f.err
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
