package usergroup

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

type fakeCustomPort struct {
	createCalls int
	createInput CreateCustomGroupInput
	createErr   error
}

func (f *fakeCustomPort) Create(_ context.Context, _ auth.CurrentUser, input CreateCustomGroupInput) (UpdatePermissionsResult, error) {
	f.createCalls++
	f.createInput = input
	return UpdatePermissionsResult{}, f.createErr
}

func TestCustomHandlerMapsInfrastructureFailureWithoutLeakingDetails(t *testing.T) {
	service := &fakeCustomPort{createErr: errors.New("database password=private")}
	handler := NewCustomHandler(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user-group/create", strings.NewReader(`{"name":"Operations","description":"Ops"}`))
	response := serveUserGroupHandler(t, http.HandlerFunc(handler.Create), auth.CurrentUser{ID: "admin-id", GroupKey: "admin"}, request)

	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	require.Equal(t, CodeInternalServerError, decodeHandlerEnvelope(t, response).Code)
	require.NotContains(t, response.Body.String(), "database password")
}

func TestCustomHandlerMapsInvalidInputAsBusinessError(t *testing.T) {
	service := &fakeCustomPort{createErr: ErrInvalidInput}
	handler := NewCustomHandler(service, slog.New(slog.NewTextHandler(io.Discard, nil)))
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user-group/create", strings.NewReader(`{"name":"Operations","description":"Ops"}`))
	response := serveUserGroupHandler(t, http.HandlerFunc(handler.Create), auth.CurrentUser{ID: "admin-id", GroupKey: "admin"}, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, CodeInvalidRequest, decodeHandlerEnvelope(t, response).Code)
	require.NotContains(t, response.Body.String(), "Internal server error")
}

func (*fakeCustomPort) UpdateDetails(context.Context, auth.CurrentUser, UpdateCustomGroupDetailsInput) (UpdatePermissionsResult, error) {
	return UpdatePermissionsResult{}, nil
}

func (*fakeCustomPort) UpdatePermissions(context.Context, auth.CurrentUser, UpdatePermissionsInput) (UpdatePermissionsResult, error) {
	return UpdatePermissionsResult{}, nil
}

func (*fakeCustomPort) Delete(context.Context, auth.CurrentUser, DeleteCustomGroupInput) (DeleteCustomGroupResult, error) {
	return DeleteCustomGroupResult{}, nil
}

func TestCustomHandlerRejectsClientControlledGroupIdentity(t *testing.T) {
	service := &fakeCustomPort{}
	handler := NewCustomHandler(service, nil)
	request := httptest.NewRequest(http.MethodPost, "/api/v1/admin/user-group/create", strings.NewReader(`{"name":"Operations","key":"admin","builtin":true}`))
	response := serveUserGroupHandler(t, http.HandlerFunc(handler.Create), auth.CurrentUser{ID: "admin-id", GroupKey: "admin"}, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want HTTP 200", response.Code)
	}
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	require.Equal(t, 0, service.createCalls, "unknown identity fields must be rejected before service dispatch")
	require.Equal(t, CodeInvalidRequest, decodeHandlerEnvelope(t, response).Code)
}
