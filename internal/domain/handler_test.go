package domain_test

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

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
)

type domainPortStub struct {
	domain.Port
	create func(context.Context, auth.CurrentUser, domain.CreateInput) (domain.Domain, error)
}

func (stub domainPortStub) Create(ctx context.Context, actor auth.CurrentUser, input domain.CreateInput) (domain.Domain, error) {
	return stub.create(ctx, actor, input)
}

func TestAvailableDomainsInterfaceReturnsEmptyItems(t *testing.T) {
	_, pool, _, user := domainFixture(t)
	service := domain.NewService(pool, permission.NewDatabaseService(pool))
	handler := domain.NewHandler(service, nil)
	serve := auth.CurrentUserMiddleware(domainUserResolver{actor: user})(http.HandlerFunc(handler.Available))
	for _, test := range []struct {
		name           string
		withMiddleware bool
		withSession    bool
	}{
		{name: "anonymous"},
		{name: "guest", withMiddleware: true},
		{name: "missing permission", withMiddleware: true, withSession: true},
		{name: "no available domains", withMiddleware: true, withSession: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if test.name == "no available domains" {
				if _, err := pool.Exec(t.Context(), `update user_group set permissions = '["short_link:create","domain:use_default"]' where key = 'user'`); err != nil {
					t.Fatalf("grant create: %v", err)
				}
				if _, err := pool.Exec(t.Context(), `delete from domain_user_group where user_group_id = (select id from user_group where key = 'user')`); err != nil {
					t.Fatalf("remove grants: %v", err)
				}
			}
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/domain/available", nil)
			if test.withSession {
				request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "test-session"})
			}
			response := httptest.NewRecorder()
			if test.withMiddleware {
				serve.ServeHTTP(response, request)
			} else {
				handler.Available(response, request)
			}
			var body struct {
				Code int `json:"code"`
				Data struct {
					Items []domain.AvailableDomain `json:"items"`
				} `json:"data"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Code != http.StatusOK || body.Code != 0 || body.Data.Items == nil || len(body.Data.Items) != 0 {
				t.Fatalf("available response = %d %s", response.Code, response.Body.String())
			}
		})
	}
}

type domainUserResolver struct{ actor auth.CurrentUser }

func (resolver domainUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return resolver.actor, nil
}

func TestDomainHandlerMapsBusinessAndSanitizesInfrastructureErrors(t *testing.T) {
	for _, test := range []struct {
		name       string
		failure    error
		wantCode   int
		wantStatus int
	}{
		{name: "permission", failure: domain.ErrPermissionDenied, wantCode: domain.CodePermissionDenied, wantStatus: http.StatusOK},
		{name: "authority conflict", failure: domain.ErrDomainConflict, wantCode: domain.CodeDomainConflict, wantStatus: http.StatusOK},
		{name: "stale", failure: domain.ErrVersionConflict, wantCode: domain.CodeVersionConflict, wantStatus: http.StatusOK},
		{name: "database", failure: errors.New("postgres://secret@private-db"), wantCode: 900000, wantStatus: http.StatusInternalServerError},
	} {
		t.Run(test.name, func(t *testing.T) {
			var logBuffer bytes.Buffer
			handler := domain.NewHandler(domainPortStub{create: func(_ context.Context, _ auth.CurrentUser, _ domain.CreateInput) (domain.Domain, error) {
				return domain.Domain{}, test.failure
			}}, slog.New(slog.NewJSONHandler(&logBuffer, nil)))
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/domain/create", strings.NewReader(`{"host":"https://go.example.com"}`))
			response := httptest.NewRecorder()
			handler.Create(response, request)
			var body struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Code != test.wantStatus || body.Code != test.wantCode {
				t.Fatalf("response = %d/%d, want %d/%d", response.Code, body.Code, test.wantStatus, test.wantCode)
			}
			if strings.Contains(response.Body.String()+logBuffer.String(), "postgres://secret") {
				t.Fatal("infrastructure detail leaked")
			}
		})
	}
}
