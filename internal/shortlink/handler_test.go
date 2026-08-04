package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
)

// TestHandlerCreateShortLinkReturnsCreatedLink verifies the create response payload.
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

// TestHandlerDecodesAccessConfigInputs verifies create and update JSON preserve explicit expiration semantics.
func TestHandlerDecodesAccessConfigInputs(t *testing.T) {
	service := &fakeShortLinkService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: service,
	})
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	createResponse := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/create", bytes.NewBufferString(fmt.Sprintf(`{
		"targetUrl":"https://example.com/docs",
		"redirectMode":"intermediate",
		"intermediateDelaySeconds":7,
		"expiration":{"mode":"at","expiresAt":%q}
	}`, future.Format(time.RFC3339))))
	router.ServeHTTP(createResponse, createRequest)
	if createResponse.Code != http.StatusOK {
		t.Fatalf("unexpected create response: %d %s", createResponse.Code, createResponse.Body.String())
	}
	if service.createInput.RedirectMode != shortlink.RedirectModeIntermediate || service.createInput.IntermediateDelaySeconds != 7 {
		t.Fatalf("unexpected create access config: %#v", service.createInput)
	}
	if service.createInput.Expiration == nil || service.createInput.Expiration.Mode != shortlink.ExpirationModeAt || service.createInput.Expiration.ExpiresAt == nil || !service.createInput.Expiration.ExpiresAt.Equal(future) {
		t.Fatalf("unexpected create expiration: %#v", service.createInput.Expiration)
	}

	updateResponse := httptest.NewRecorder()
	updateRequest := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/update", bytes.NewBufferString(`{
		"id":"link-id",
		"redirectMode":"direct",
		"intermediateDelaySeconds":5,
		"expiration":{"mode":"never"}
	}`))
	router.ServeHTTP(updateResponse, updateRequest)
	if updateResponse.Code != http.StatusOK {
		t.Fatalf("unexpected update response: %d %s", updateResponse.Code, updateResponse.Body.String())
	}
	if service.updateInput.RedirectMode == nil || *service.updateInput.RedirectMode != shortlink.RedirectModeDirect {
		t.Fatalf("unexpected update mode: %#v", service.updateInput)
	}
	if service.updateInput.IntermediateDelaySeconds == nil || *service.updateInput.IntermediateDelaySeconds != 5 {
		t.Fatalf("unexpected update delay: %#v", service.updateInput)
	}
	if service.updateInput.Expiration == nil || service.updateInput.Expiration.Mode != shortlink.ExpirationModeNever || service.updateInput.Expiration.ExpiresAt != nil {
		t.Fatalf("unexpected update expiration: %#v", service.updateInput.Expiration)
	}
}

// TestHandlerCreateShortLinkMapsBusinessErrors verifies create error-code mappings.
func TestHandlerCreateShortLinkMapsBusinessErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code int
	}{
		{name: "permission denied", err: shortlink.ErrPermissionDenied, code: 120001},
		{name: "invalid target url", err: shortlink.ErrInvalidTargetURL, code: 200103},
		{name: "invalid redirect mode", err: shortlink.ErrInvalidRedirectMode, code: 200106},
		{name: "invalid intermediate delay", err: shortlink.ErrInvalidIntermediateDelay, code: 200107},
		{name: "invalid expiration", err: shortlink.ErrInvalidExpiration, code: 200108},
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

			if response.Code != http.StatusOK {
				t.Fatalf("expected status %d, got %d", http.StatusOK, response.Code)
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

func TestShortLinkBusinessErrorCodesRemainStable(t *testing.T) {
	codes := map[string]int{
		"slug conflict":              shortlink.CodeSlugConflict,
		"reserved slug":              shortlink.CodeReservedSlug,
		"invalid target url":         shortlink.CodeInvalidTargetURL,
		"missing":                    shortlink.CodeShortLinkMissing,
		"disabled":                   shortlink.CodeShortLinkDisabled,
		"invalid redirect mode":      shortlink.CodeInvalidRedirectMode,
		"invalid intermediate delay": shortlink.CodeInvalidIntermediateDelay,
		"invalid expiration":         shortlink.CodeInvalidExpiration,
		"expired":                    shortlink.CodeShortLinkExpired,
		"not intermediate":           shortlink.CodeShortLinkNotIntermediate,
	}
	expected := map[string]int{
		"slug conflict":              200101,
		"reserved slug":              200102,
		"invalid target url":         200103,
		"missing":                    200104,
		"disabled":                   200105,
		"invalid redirect mode":      200106,
		"invalid intermediate delay": 200107,
		"invalid expiration":         200108,
		"expired":                    200109,
		"not intermediate":           200110,
	}
	for name, code := range codes {
		if code != expected[name] {
			t.Fatalf("%s code = %d, want %d", name, code, expected[name])
		}
	}
}

// TestHandlerCreateShortLinkRejectsInvalidJSONAndMapsSystemError covers malformed and internal failures.
func TestHandlerCreateShortLinkRejectsInvalidJSONAndMapsSystemError(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "invalid json", body: `{`, httpStatus: http.StatusOK, code: 100001},
		{name: "system", body: `{"targetUrl":"https://example.com"}`, err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				ShortLink:   &fakeShortLinkService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/v1/short-link/create", bytes.NewBufferString(tt.body))

			router.ServeHTTP(response, request)

			assertBusinessCode(t, response, tt.httpStatus, tt.code)
		})
	}
}

// TestHandlerListShortLinksReturnsItemsAndMeta verifies list data and pagination metadata.
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
					{
						ID:        "link-id",
						URL:       "https://go.example.com/abc123",
						Slug:      "abc123",
						TargetURL: "https://example.com",
						Status:    "active",
						Stats:     &shortlink.ShortLinkStats{VisitCount: 2, TodayVisitCount: 1},
					},
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
	if body.Data.Items[0].Stats == nil || body.Data.Items[0].Stats.VisitCount != 2 || body.Data.Items[0].Stats.TodayVisitCount != 1 {
		t.Fatalf("unexpected stats: %#v", body.Data.Items[0].Stats)
	}
	if body.Meta.Page != 2 || body.Meta.PageSize != 10 || body.Meta.Total != 21 {
		t.Fatalf("unexpected meta: %#v", body.Meta)
	}
}

// TestHandlerOverviewReturnsPersonalAggregates verifies the overview response payload.
func TestHandlerOverviewReturnsPersonalAggregates(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{
		ShortLink: &fakeShortLinkService{
			overviewResult: shortlink.OverviewResult{
				TotalLinkCount:  12,
				ActiveLinkCount: 9,
				VisitCount:      840,
				TodayVisitCount: 31,
			},
		},
	})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/overview", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("expected http 200, got %d", response.Code)
	}
	var body struct {
		Code int                      `json:"code"`
		Data shortlink.OverviewResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != 0 || body.Data.TotalLinkCount != 12 || body.Data.ActiveLinkCount != 9 || body.Data.VisitCount != 840 || body.Data.TodayVisitCount != 31 {
		t.Fatalf("unexpected overview response: %#v", body)
	}
}

// TestHandlerOverviewMapsErrors verifies business and infrastructure response conventions.
func TestHandlerOverviewMapsErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "permission denied", err: shortlink.ErrPermissionDenied, httpStatus: http.StatusOK, code: shortlink.CodePermissionDenied},
		{name: "database failure", err: errors.New("database unavailable"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{ShortLink: &fakeShortLinkService{err: test.err}})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/overview", nil))
			assertBusinessCode(t, response, test.httpStatus, test.code)
		})
	}
}

// TestHandlerOverviewRejectsPost verifies overview remains a read-only GET route.
func TestHandlerOverviewRejectsPost(t *testing.T) {
	router := apphttp.NewRouter(apphttp.Dependencies{ShortLink: &fakeShortLinkService{}})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/short-link/overview", nil))
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected http 405, got %d body %q", response.Code, response.Body.String())
	}
}

// TestHandlerStatisticsReturnsAnalyticsAndForwardsID verifies the owner statistics endpoint.
func TestHandlerStatisticsReturnsAnalyticsAndForwardsID(t *testing.T) {
	service := &fakeShortLinkService{statisticsResult: shortlink.StatisticsResult{
		ShortLink: shortlink.ShortLink{ID: "link-id", Slug: "abc123"},
		Stats:     shortlink.AnalyticsStats{VisitCount: 2, Trend: []shortlink.AnalyticsTrendPoint{{Date: "2026-07-17", VisitCount: 2}}},
	}}
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{}, ShortLink: service})
	response := httptest.NewRecorder()

	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/short-link/statistics?id=link-id", nil))

	if response.Code != http.StatusOK || service.statisticsInput.ID != "link-id" {
		t.Fatalf("unexpected response %d or input %#v", response.Code, service.statisticsInput)
	}
	var body struct {
		Code int                        `json:"code"`
		Data shortlink.StatisticsResult `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil || body.Code != 0 || body.Data.Stats.VisitCount != 2 {
		t.Fatalf("unexpected statistics body %#v, %v", body, err)
	}
}

// TestHandlerAdminStatisticsReturnsAnalyticsAndForwardsID verifies the administrator statistics endpoint.
func TestHandlerAdminStatisticsReturnsAnalyticsAndForwardsID(t *testing.T) {
	service := &fakeShortLinkService{statisticsResult: shortlink.StatisticsResult{Stats: shortlink.AnalyticsStats{VisitCount: 3}}}
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{}, ShortLink: service})
	response := httptest.NewRecorder()

	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/admin/short-link/statistics?id=link-id", nil))

	if response.Code != http.StatusOK || service.statisticsInput.ID != "link-id" {
		t.Fatalf("unexpected response %d or input %#v", response.Code, service.statisticsInput)
	}
}

// TestHandlerStatisticsMapsErrors verifies both statistics endpoints preserve response conventions.
func TestHandlerStatisticsMapsErrors(t *testing.T) {
	tests := []struct {
		path   string
		err    error
		status int
		code   int
	}{
		{path: "/api/v1/short-link/statistics?id=bad", err: shortlink.ErrInvalidShortLinkID, status: http.StatusOK, code: 100001},
		{path: "/api/v1/admin/short-link/statistics?id=missing", err: shortlink.ErrShortLinkMissing, status: http.StatusOK, code: 200104},
		{path: "/api/v1/short-link/statistics?id=link-id", err: errors.New("database down"), status: http.StatusInternalServerError, code: 900000},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{}, ShortLink: &fakeShortLinkService{err: test.err}})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			assertBusinessCode(t, response, test.status, test.code)
		})
	}
}

// TestHandlerListShortLinksUsesDefaultPaginationForInvalidQuery verifies invalid pagination defaults.
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

// TestHandlerListShortLinksPassesStatusFilter verifies status query forwarding.
func TestHandlerListShortLinksPassesStatusFilter(t *testing.T) {
	service := &fakeShortLinkService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: service,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/list?page=2&pageSize=10&status=disabled", nil)

	router.ServeHTTP(response, request)

	if service.listInput.Page != 2 || service.listInput.PageSize != 10 {
		t.Fatalf("unexpected pagination: %#v", service.listInput)
	}
	if service.listInput.Status != "disabled" {
		t.Fatalf("expected disabled status filter, got %q", service.listInput.Status)
	}
}

// TestHandlerListShortLinksUsesDefaultPaginationForMissingQuery verifies absent pagination defaults.
func TestHandlerListShortLinksUsesDefaultPaginationForMissingQuery(t *testing.T) {
	service := &fakeShortLinkService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "user-id", Username: "alice", GroupKey: "user", Permissions: permission.UserPermissions},
		},
		ShortLink: service,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/list", nil)

	router.ServeHTTP(response, request)

	if service.listInput.Page != 1 {
		t.Fatalf("expected default page 1, got %d", service.listInput.Page)
	}
	if service.listInput.PageSize != 20 {
		t.Fatalf("expected default pageSize 20, got %d", service.listInput.PageSize)
	}
}

// TestHandlerListShortLinksMapsErrors verifies list business and infrastructure failures.
func TestHandlerListShortLinksMapsErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "permission denied", err: shortlink.ErrPermissionDenied, httpStatus: http.StatusOK, code: 120001},
		{name: "invalid status", err: shortlink.ErrInvalidStatus, httpStatus: http.StatusOK, code: 100001},
		{name: "system", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				ShortLink:   &fakeShortLinkService{err: tt.err},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/list", nil)

			router.ServeHTTP(response, request)

			assertBusinessCode(t, response, tt.httpStatus, tt.code)
		})
	}
}

// TestHandlerUpdateShortLinkReturnsUpdatedLink verifies update response serialization.
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

// TestHandlerDeleteShortLinkReturnsOK verifies successful delete responses.
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

// TestHandlerMapsMissingShortLink verifies missing-link business responses.
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

// TestHandlerUpdateDeleteAndAdminRoutesRejectInvalidJSON verifies malformed bodies across mutating routes.
func TestHandlerUpdateDeleteAndAdminRoutesRejectInvalidJSON(t *testing.T) {
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{name: "update", method: http.MethodPost, path: "/api/v1/short-link/update"},
		{name: "delete", method: http.MethodPost, path: "/api/v1/short-link/delete"},
		{name: "admin update", method: http.MethodPost, path: "/api/v1/admin/short-link/update"},
		{name: "admin delete", method: http.MethodPost, path: "/api/v1/admin/short-link/delete"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				ShortLink:   &fakeShortLinkService{},
			})
			response := httptest.NewRecorder()
			request := httptest.NewRequest(tt.method, tt.path, bytes.NewBufferString(`{`))

			router.ServeHTTP(response, request)

			assertBusinessCode(t, response, http.StatusOK, 100001)
		})
	}
}

// TestHandlerWriteBusinessOrSystemErrorMappings verifies all shared error mappings.
func TestHandlerWriteBusinessOrSystemErrorMappings(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		err        error
		httpStatus int
		code       int
	}{
		{name: "update permission", path: "/api/v1/short-link/update", err: shortlink.ErrPermissionDenied, httpStatus: http.StatusOK, code: 120001},
		{name: "update invalid target", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidTargetURL, httpStatus: http.StatusOK, code: 200103},
		{name: "update invalid status", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidStatus, httpStatus: http.StatusOK, code: 100001},
		{name: "update invalid redirect mode", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidRedirectMode, httpStatus: http.StatusOK, code: 200106},
		{name: "update invalid intermediate delay", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidIntermediateDelay, httpStatus: http.StatusOK, code: 200107},
		{name: "update invalid expiration", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidExpiration, httpStatus: http.StatusOK, code: 200108},
		{name: "update invalid password", path: "/api/v1/short-link/update", err: shortlink.ErrInvalidPasswordInput, httpStatus: http.StatusOK, code: 100001},
		{name: "update slug conflict", path: "/api/v1/short-link/update", err: shortlink.ErrSlugConflict, httpStatus: http.StatusOK, code: 200101},
		{name: "update reserved slug", path: "/api/v1/short-link/update", err: shortlink.ErrReservedSlug, httpStatus: http.StatusOK, code: 200102},
		{name: "update system", path: "/api/v1/short-link/update", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
		{name: "admin list permission", path: "/api/v1/admin/short-link/list", err: shortlink.ErrPermissionDenied, httpStatus: http.StatusOK, code: 120001},
		{name: "admin update missing", path: "/api/v1/admin/short-link/update", err: shortlink.ErrShortLinkMissing, httpStatus: http.StatusOK, code: 200104},
		{name: "admin delete system", path: "/api/v1/admin/short-link/delete", err: errors.New("database down"), httpStatus: http.StatusInternalServerError, code: 900000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			router := apphttp.NewRouter(apphttp.Dependencies{
				CurrentUser: &fakeCurrentUserResolver{},
				ShortLink:   &fakeShortLinkService{err: tt.err},
			})
			response := httptest.NewRecorder()
			method := http.MethodPost
			body := `{"id":"link-id"}`
			if tt.path == "/api/v1/admin/short-link/list" {
				method = http.MethodGet
				body = ""
			}
			request := httptest.NewRequest(method, tt.path, bytes.NewBufferString(body))

			router.ServeHTTP(response, request)

			assertBusinessCode(t, response, tt.httpStatus, tt.code)
		})
	}
}

// TestHandlerAdminListShortLinksReturnsOwners verifies administrator list owner summaries.
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

// TestHandlerAdminListShortLinksPassesFilters verifies administrator query forwarding.
func TestHandlerAdminListShortLinksPassesFilters(t *testing.T) {
	service := &fakeShortLinkService{}
	router := apphttp.NewRouter(apphttp.Dependencies{
		CurrentUser: &fakeCurrentUserResolver{
			user: auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: "admin", Permissions: permission.AdminPermissions},
		},
		ShortLink: service,
	})
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/admin/short-link/list?page=3&pageSize=15&status=active&q=alice", nil)

	router.ServeHTTP(response, request)

	if service.adminListInput.Page != 3 || service.adminListInput.PageSize != 15 {
		t.Fatalf("unexpected pagination: %#v", service.adminListInput)
	}
	if service.adminListInput.Status != "active" {
		t.Fatalf("expected active status filter, got %q", service.adminListInput.Status)
	}
	if service.adminListInput.Query != "alice" {
		t.Fatalf("expected alice query, got %q", service.adminListInput.Query)
	}
}

// TestHandlerAdminUpdateAndDeleteShortLinks verifies administrator mutation routes.
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
	result           shortlink.CreateResult
	overviewResult   shortlink.OverviewResult
	listResult       shortlink.ListResult
	listInput        shortlink.ListInput
	adminListResult  shortlink.AdminListResult
	adminListInput   shortlink.ListInput
	statisticsResult shortlink.StatisticsResult
	statisticsInput  shortlink.StatisticsInput
	createInput      shortlink.CreateInput
	updateInput      shortlink.UpdateInput
	err              error
}

// Overview returns the configured personal aggregate result.
func (f *fakeShortLinkService) Overview(context.Context, auth.CurrentUser) (shortlink.OverviewResult, error) {
	return f.overviewResult, f.err
}

// Create returns the configured create result for handler tests.
func (f *fakeShortLinkService) Create(_ context.Context, _ auth.CurrentUser, input shortlink.CreateInput) (shortlink.CreateResult, error) {
	f.createInput = input
	return f.result, f.err
}

// List records list input and returns the configured result for handler tests.
func (f *fakeShortLinkService) List(_ context.Context, _ auth.CurrentUser, input shortlink.ListInput) (shortlink.ListResult, error) {
	f.listInput = input
	return f.listResult, f.err
}

// Update returns the configured update result for handler tests.
func (f *fakeShortLinkService) Update(_ context.Context, _ auth.CurrentUser, input shortlink.UpdateInput) (shortlink.CreateResult, error) {
	f.updateInput = input
	return f.result, f.err
}

// Delete returns the configured delete error for handler tests.
func (f *fakeShortLinkService) Delete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return f.err
}

// Statistics records analytics input and returns the configured result.
func (f *fakeShortLinkService) Statistics(_ context.Context, _ auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	f.statisticsInput = input
	return f.statisticsResult, f.err
}

// AdminList records administrator list input and returns the configured result.
func (f *fakeShortLinkService) AdminList(_ context.Context, _ auth.CurrentUser, input shortlink.ListInput) (shortlink.AdminListResult, error) {
	f.adminListInput = input
	return f.adminListResult, f.err
}

// AdminStatistics records administrator analytics input and returns the configured result.
func (f *fakeShortLinkService) AdminStatistics(_ context.Context, _ auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsResult, error) {
	f.statisticsInput = input
	return f.statisticsResult, f.err
}

// AdminUpdate returns the configured administrator update result.
func (f *fakeShortLinkService) AdminUpdate(_ context.Context, _ auth.CurrentUser, input shortlink.UpdateInput) (shortlink.CreateResult, error) {
	f.updateInput = input
	return f.result, f.err
}

// AdminDelete returns the configured administrator delete error.
func (f *fakeShortLinkService) AdminDelete(context.Context, auth.CurrentUser, shortlink.DeleteInput) error {
	return f.err
}

type fakeCurrentUserResolver struct {
	user auth.CurrentUser
	err  error
}

// ResolveCurrentUser returns the configured request identity for handler tests.
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

// assertBusinessCode verifies a unified HTTP status and business code.
func assertBusinessCode(t *testing.T, response *httptest.ResponseRecorder, httpStatus int, code int) {
	t.Helper()
	if response.Code != httpStatus {
		t.Fatalf("expected http status %d, got %d body %q", httpStatus, response.Code, response.Body.String())
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if body.Code != code {
		t.Fatalf("expected code %d, got %d", code, body.Code)
	}
}
