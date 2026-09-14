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
)

type domainPortStub struct {
	domain.Port
	create func(context.Context, auth.CurrentUser, domain.CreateInput) (domain.Domain, error)
}

func (stub domainPortStub) Create(ctx context.Context, actor auth.CurrentUser, input domain.CreateInput) (domain.Domain, error) {
	return stub.create(ctx, actor, input)
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
