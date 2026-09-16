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
	"github.com/jackc/pgx/v5/pgconn"
)

type domainPortStub struct {
	domain.Port
	list       func(context.Context, auth.CurrentUser) (domain.ListResult, error)
	available  func(context.Context, auth.CurrentUser) (domain.AvailableResult, error)
	create     func(context.Context, auth.CurrentUser, domain.CreateInput) (domain.Domain, error)
	update     func(context.Context, auth.CurrentUser, domain.UpdateInput) (domain.Domain, error)
	setDefault func(context.Context, auth.CurrentUser, domain.ChangeInput) (domain.Domain, error)
	delete     func(context.Context, auth.CurrentUser, domain.ChangeInput) error
}

func (stub domainPortStub) List(ctx context.Context, actor auth.CurrentUser) (domain.ListResult, error) {
	return stub.list(ctx, actor)
}

func (stub domainPortStub) Available(ctx context.Context, actor auth.CurrentUser) (domain.AvailableResult, error) {
	return stub.available(ctx, actor)
}

func (stub domainPortStub) Create(ctx context.Context, actor auth.CurrentUser, input domain.CreateInput) (domain.Domain, error) {
	return stub.create(ctx, actor, input)
}

func (stub domainPortStub) Update(ctx context.Context, actor auth.CurrentUser, input domain.UpdateInput) (domain.Domain, error) {
	return stub.update(ctx, actor, input)
}

func (stub domainPortStub) SetDefault(ctx context.Context, actor auth.CurrentUser, input domain.ChangeInput) (domain.Domain, error) {
	return stub.setDefault(ctx, actor, input)
}

func (stub domainPortStub) Delete(ctx context.Context, actor auth.CurrentUser, input domain.ChangeInput) error {
	return stub.delete(ctx, actor, input)
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
		name        string
		failure     error
		wantCode    int
		wantStatus  int
		logCategory string
	}{
		{name: "permission", failure: domain.ErrPermissionDenied, wantCode: domain.CodePermissionDenied, wantStatus: http.StatusOK},
		{name: "invalid", failure: domain.ErrInvalidInput, wantCode: 100001, wantStatus: http.StatusOK},
		{name: "authority conflict", failure: domain.ErrDomainConflict, wantCode: domain.CodeDomainConflict, wantStatus: http.StatusOK},
		{name: "not found", failure: domain.ErrDomainNotFound, wantCode: domain.CodeDomainNotFound, wantStatus: http.StatusOK},
		{name: "stale", failure: domain.ErrVersionConflict, wantCode: domain.CodeVersionConflict, wantStatus: http.StatusOK},
		{name: "referenced", failure: domain.ErrDomainReferenced, wantCode: domain.CodeDomainReferenced, wantStatus: http.StatusOK},
		{name: "protected", failure: domain.ErrDomainProtected, wantCode: domain.CodeDomainProtected, wantStatus: http.StatusOK},
		{name: "database", failure: &pgconn.PgError{Code: "08006"}, wantCode: 900000, wantStatus: http.StatusInternalServerError, logCategory: "database"},
		{name: "timeout", failure: context.DeadlineExceeded, wantCode: 900000, wantStatus: http.StatusInternalServerError, logCategory: "timeout"},
		{name: "unknown", failure: errors.New("postgres://secret@private-db"), wantCode: 900000, wantStatus: http.StatusInternalServerError, logCategory: "unknown"},
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
			if test.logCategory != "" && !strings.Contains(logBuffer.String(), `"error_category":"`+test.logCategory+`"`) {
				t.Fatalf("log = %s, want category %s", logBuffer.String(), test.logCategory)
			}
		})
	}
}

func TestDomainHandlerCoversEndpointSuccessFailureAndInvalidInput(t *testing.T) {
	managed := domain.Domain{ID: "00000000-0000-4000-8000-000000000801", Host: "https://go.example.com"}
	success := domainPortStub{
		list: func(context.Context, auth.CurrentUser) (domain.ListResult, error) {
			return domain.ListResult{Items: []domain.Domain{managed}}, nil
		},
		available: func(context.Context, auth.CurrentUser) (domain.AvailableResult, error) {
			return domain.AvailableResult{Items: []domain.AvailableDomain{}}, nil
		},
		create: func(context.Context, auth.CurrentUser, domain.CreateInput) (domain.Domain, error) {
			return managed, nil
		},
		update: func(context.Context, auth.CurrentUser, domain.UpdateInput) (domain.Domain, error) {
			return managed, nil
		},
		setDefault: func(context.Context, auth.CurrentUser, domain.ChangeInput) (domain.Domain, error) {
			return managed, nil
		},
		delete: func(context.Context, auth.CurrentUser, domain.ChangeInput) error { return nil },
	}
	failure := domainPortStub{
		list: func(context.Context, auth.CurrentUser) (domain.ListResult, error) {
			return domain.ListResult{}, domain.ErrDomainNotFound
		},
		available: func(context.Context, auth.CurrentUser) (domain.AvailableResult, error) {
			return domain.AvailableResult{}, domain.ErrDomainNotFound
		},
		create: func(context.Context, auth.CurrentUser, domain.CreateInput) (domain.Domain, error) {
			return domain.Domain{}, domain.ErrDomainNotFound
		},
		update: func(context.Context, auth.CurrentUser, domain.UpdateInput) (domain.Domain, error) {
			return domain.Domain{}, domain.ErrDomainNotFound
		},
		setDefault: func(context.Context, auth.CurrentUser, domain.ChangeInput) (domain.Domain, error) {
			return domain.Domain{}, domain.ErrDomainNotFound
		},
		delete: func(context.Context, auth.CurrentUser, domain.ChangeInput) error { return domain.ErrDomainNotFound },
	}
	tests := []struct {
		name     string
		port     domainPortStub
		body     string
		serve    func(*domain.Handler, http.ResponseWriter, *http.Request)
		wantCode int
	}{
		{name: "list success", port: success, serve: (*domain.Handler).List},
		{name: "list failure", port: failure, serve: (*domain.Handler).List, wantCode: domain.CodeDomainNotFound},
		{name: "available failure", port: failure, serve: (*domain.Handler).Available, wantCode: domain.CodeDomainNotFound},
		{name: "create success", port: success, body: `{}`, serve: (*domain.Handler).Create},
		{name: "create invalid", port: success, body: `{`, serve: (*domain.Handler).Create, wantCode: 100001},
		{name: "update success", port: success, body: `{}`, serve: (*domain.Handler).Update},
		{name: "update failure", port: failure, body: `{}`, serve: (*domain.Handler).Update, wantCode: domain.CodeDomainNotFound},
		{name: "update invalid", port: success, body: `{`, serve: (*domain.Handler).Update, wantCode: 100001},
		{name: "set default success", port: success, body: `{}`, serve: (*domain.Handler).SetDefault},
		{name: "set default failure", port: failure, body: `{}`, serve: (*domain.Handler).SetDefault, wantCode: domain.CodeDomainNotFound},
		{name: "set default invalid", port: success, body: `{`, serve: (*domain.Handler).SetDefault, wantCode: 100001},
		{name: "delete success", port: success, body: `{}`, serve: (*domain.Handler).Delete},
		{name: "delete failure", port: failure, body: `{}`, serve: (*domain.Handler).Delete, wantCode: domain.CodeDomainNotFound},
		{name: "delete invalid", port: success, body: `{`, serve: (*domain.Handler).Delete, wantCode: 100001},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := domain.NewHandler(test.port, nil)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			test.serve(handler, response, request)
			var body struct {
				Code int `json:"code"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if response.Code != http.StatusOK || body.Code != test.wantCode {
				t.Fatalf("response = %d/%d, want 200/%d", response.Code, body.Code, test.wantCode)
			}
		})
	}
}
