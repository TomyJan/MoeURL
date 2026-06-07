package shortlink_test

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
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

func TestHandlerCreateShortLinkReturnsCreatedLink(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{
				ID:          "user-id",
				Username:    "alice",
				Nickname:    "Alice",
				GroupKey:    "user",
				Permissions: permission.UserPermissions,
			},
		},
		ShortLink: &fakeShortLinkService{
			result: shortlink.CreateResult{
				ShortLink: shortlink.ShortLink{
					ID:        "link-id",
					URL:       "https://go.example.com/abc123",
					Slug:      "abc123",
					TargetURL: "https://example.com",
					Status:    "active",
				},
			},
		},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/create", bytes.NewBufferString(`{
		"targetUrl": "https://example.com"
	}`))
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}

	var body struct {
		Code int `json:"code"`
		Data struct {
			ShortLink shortlink.ShortLink `json:"shortLink"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if body.Data.ShortLink.Slug != "abc123" {
		t.Fatalf("expected slug abc123, got %s", body.Data.ShortLink.Slug)
	}
}

func TestHandlerCreateShortLinkMapsBusinessErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
	}{
		{name: "permission denied", err: shortlink.ErrPermissionDenied, code: 120001},
		{name: "invalid target url", err: shortlink.ErrInvalidTargetURL, code: 200103},
		{name: "slug conflict", err: shortlink.ErrSlugConflict, code: 200101},
		{name: "reserved slug", err: shortlink.ErrReservedSlug, code: 200102},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				ShortLink:   &fakeShortLinkService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/create", bytes.NewBufferString(`{
				"targetUrl": "javascript:alert(1)"
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

func TestHandlerListShortLinksReturnsItemsAndMeta(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{
				ID:          "user-id",
				Username:    "alice",
				Nickname:    "Alice",
				GroupKey:    "user",
				Permissions: permission.UserPermissions,
			},
		},
		ShortLink: &fakeShortLinkService{
			listResult: shortlink.ListResult{
				Items: []shortlink.ShortLink{
					{ID: "link-id", URL: "https://go.example.com/abc123", Slug: "abc123", TargetURL: "https://example.com", Status: "active"},
				},
				Page:     2,
				PageSize: 10,
				Total:    21,
			},
		},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/list?page=2&pageSize=10", nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-id"})

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			Items []shortlink.ShortLink `json:"items"`
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
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if len(body.Data.Items) != 1 || body.Data.Items[0].Slug != "abc123" {
		t.Fatalf("unexpected items: %#v", body.Data.Items)
	}
	if body.Meta.Page != 2 || body.Meta.PageSize != 10 || body.Meta.Total != 21 {
		t.Fatalf("unexpected meta: %#v", body.Meta)
	}
}

func TestHandlerListShortLinksUsesDefaultPaginationForInvalidQuery(t *testing.T) {
	service := &fakeShortLinkService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: service,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/list?page=bad&pageSize=bad", nil)

	router.ServeHTTP(response, request)

	if service.listInput.Page != 1 {
		t.Fatalf("expected default page 1, got %d", service.listInput.Page)
	}
	if service.listInput.PageSize != 20 {
		t.Fatalf("expected default pageSize 20, got %d", service.listInput.PageSize)
	}
}

func TestHandlerUpdateShortLinkReturnsUpdatedLink(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: &fakeShortLinkService{
			result: shortlink.CreateResult{
				ShortLink: shortlink.ShortLink{ID: "link-id", URL: "https://go.example.com/abc123", Slug: "abc123", TargetURL: "https://example.org", Status: "disabled"},
			},
		},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/update", bytes.NewBufferString(`{
		"id": "link-id",
		"targetUrl": "https://example.org",
		"status": "disabled"
	}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			ShortLink shortlink.ShortLink `json:"shortLink"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 {
		t.Fatalf("expected code 0, got %d", body.Code)
	}
	if body.Data.ShortLink.Status != "disabled" {
		t.Fatalf("expected disabled, got %q", body.Data.ShortLink.Status)
	}
}

func TestHandlerDeleteShortLinkReturnsOK(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: &fakeShortLinkService{},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/delete", bytes.NewBufferString(`{
		"id": "link-id"
	}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			Deleted bool `json:"deleted"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || !body.Data.Deleted {
		t.Fatalf("unexpected response: %#v", body)
	}
}

func TestHandlerMapsMissingShortLink(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{},
		ShortLink:   &fakeShortLinkService{err: shortlink.ErrShortLinkMissing},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/delete", bytes.NewBufferString(`{
		"id": "missing"
	}`))

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 200104 {
		t.Fatalf("expected code 200104, got %d", body.Code)
	}
}

func TestHandlerAdminListShortLinksReturnsOwners(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions},
		},
		ShortLink: &fakeShortLinkService{
			adminListResult: shortlink.AdminListResult{
				Items: []shortlink.AdminShortLink{
					{
						ID:        "link-id",
						URL:       "https://go.example.com/abc123",
						Slug:      "abc123",
						TargetURL: "https://example.com",
						Status:    "active",
						Owner:     shortlink.OwnerSummary{ID: "owner-id", Username: "alice", Nickname: "Alice"},
					},
				},
				Page:     1,
				PageSize: 20,
				Total:    1,
			},
		},
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/short-link/list?page=1&pageSize=20", nil)

	router.ServeHTTP(response, request)

	var body struct {
		Code int `json:"code"`
		Data struct {
			Items []shortlink.AdminShortLink `json:"items"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || len(body.Data.Items) != 1 || body.Data.Items[0].Owner.Username != "alice" {
		t.Fatalf("unexpected body: %#v", body)
	}
}

func TestHandlerAdminUpdateAndDeleteShortLinks(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions},
		},
		ShortLink: &fakeShortLinkService{
			result: shortlink.CreateResult{ShortLink: shortlink.ShortLink{ID: "link-id", Status: "disabled"}},
		},
	})

	updateResponse := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/short-link/update", bytes.NewBufferString(`{
		"id": "link-id",
		"status": "disabled"
	}`))
	router.ServeHTTP(updateResponse, updateRequest)
	var updateBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(updateResponse.Body).Decode(&updateBody); err != nil {
		t.Fatalf("decode update response: %v", err)
	}
	if updateBody.Code != 0 {
		t.Fatalf("expected update code 0, got %d", updateBody.Code)
	}

	deleteResponse := httptest.NewRecorder()
	deleteRequest := httptest.NewRequest(http.MethodPost, "/api/v1/admin/short-link/delete", bytes.NewBufferString(`{
		"id": "link-id"
	}`))
	router.ServeHTTP(deleteResponse, deleteRequest)
	var deleteBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(deleteResponse.Body).Decode(&deleteBody); err != nil {
		t.Fatalf("decode delete response: %v", err)
	}
	if deleteBody.Code != 0 {
		t.Fatalf("expected delete code 0, got %d", deleteBody.Code)
	}
}

type fakeShortLinkService struct {
	result          shortlink.CreateResult
	listResult      shortlink.ListResult
	listInput       shortlink.ListInput
	adminListResult shortlink.AdminListResult
	adminListInput  shortlink.ListInput
	err             error
}

func (f *fakeShortLinkService) Create(context.Context, auth.CurrentUser, shortlink.CreateInput) (shortlink.CreateResult, error) {
	return f.result, f.err
}

func (f *fakeShortLinkService) List(_ context.Context, _ auth.CurrentUser, input shortlink.ListInput) (shortlink.ListResult, error) {
	f.listInput = input
	return f.listResult, f.err
}

func (f *fakeShortLinkService) Update(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return f.result, f.err
}

func (f *fakeShortLinkService) Delete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return f.err
}

func (f *fakeShortLinkService) AdminList(_ context.Context, _ auth.CurrentUser, input shortlink.ListInput) (shortlink.AdminListResult, error) {
	f.adminListInput = input
	return f.adminListResult, f.err
}

func (f *fakeShortLinkService) AdminUpdate(context.Context, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error) {
	return f.result, f.err
}

func (f *fakeShortLinkService) AdminDelete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
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
