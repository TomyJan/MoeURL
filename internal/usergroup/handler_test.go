package usergroup

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
)

type fakeUserGroupService struct {
	listResult   ListResult
	listErr      error
	updateResult UpdatePermissionsResult
	updateErr    error

	listCalls   int
	updateCalls int
	listActor   auth.CurrentUser
	updateActor auth.CurrentUser
	updateInput UpdatePermissionsInput
}

// List records the actor and returns the configured list result.
func (f *fakeUserGroupService) List(_ context.Context, actor auth.CurrentUser) (ListResult, error) {
	f.listCalls++
	f.listActor = actor
	return f.listResult, f.listErr
}

// UpdatePermissions records the actor and input before returning the configured result.
func (f *fakeUserGroupService) UpdatePermissions(_ context.Context, actor auth.CurrentUser, input UpdatePermissionsInput) (UpdatePermissionsResult, error) {
	f.updateCalls++
	f.updateActor = actor
	f.updateInput = input
	return f.updateResult, f.updateErr
}

type handlerCurrentUserResolver struct {
	actor auth.CurrentUser
}

// ResolveCurrentUser returns the actor configured for a handler test.
func (r handlerCurrentUserResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.actor, nil
}

type handlerEnvelope struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data"`
	Meta    map[string]any  `json:"meta"`
}

// serveUserGroupHandler executes a request with an authenticated test actor.
func serveUserGroupHandler(t *testing.T, handler http.Handler, actor auth.CurrentUser, request *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session-secret-value"})
	response := httptest.NewRecorder()
	auth.CurrentUserMiddleware(handlerCurrentUserResolver{actor: actor})(handler).ServeHTTP(response, request)
	return response
}

// decodeHandlerEnvelope parses the unified response envelope or fails the test.
func decodeHandlerEnvelope(t *testing.T, response *httptest.ResponseRecorder) handlerEnvelope {
	t.Helper()
	var envelope handlerEnvelope
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode response: %v; body=%q", err, response.Body.String())
	}
	return envelope
}

// TestHandlerListReturnsUnifiedResultAndActor verifies list response and actor forwarding.
func TestHandlerListReturnsUnifiedResultAndActor(t *testing.T) {
	actor := auth.CurrentUser{ID: "admin-id", Username: "admin", GroupKey: permission.GroupAdmin}
	service := &fakeUserGroupService{listResult: ListResult{
		Groups: []UserGroup{{Key: permission.GroupGuest, Permissions: []string{}, UpdatedAt: "2026-08-20T03:04:05Z"}},
	}}
	handler := NewHandler(service, slog.New(slog.NewTextHandler(io.Discard, nil)))

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.List), actor, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user-group/list", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	envelope := decodeHandlerEnvelope(t, response)
	if envelope.Code != 0 || envelope.Message != "OK" || envelope.Meta == nil {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
	var result ListResult
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatalf("decode list data: %v", err)
	}
	if len(result.Groups) != 1 || result.Groups[0].Key != permission.GroupGuest {
		t.Fatalf("unexpected list data: %#v", result)
	}
	if service.listCalls != 1 || service.listActor.ID != actor.ID || service.listActor.GroupKey != actor.GroupKey {
		t.Fatalf("service actor = %#v after %d calls, want %#v", service.listActor, service.listCalls, actor)
	}
}

// TestHandlerUpdatePermissionsDecodesInputAndReturnsGroup verifies update request and response mapping.
func TestHandlerUpdatePermissionsDecodesInputAndReturnsGroup(t *testing.T) {
	actor := auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}
	service := &fakeUserGroupService{updateResult: UpdatePermissionsResult{Group: UserGroup{
		Key: permission.GroupUser, Editable: true, Permissions: []string{permission.ShortLinkCreate}, UpdatedAt: "2026-08-20T03:04:06.123456Z",
	}}}
	handler := NewHandler(service, nil)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader(`{
		"groupKey":"user",
		"permissions":["short_link:create"],
		"expectedUpdatedAt":"2026-08-20T03:04:05.123456Z"
	}`))

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), actor, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	envelope := decodeHandlerEnvelope(t, response)
	if envelope.Code != 0 || envelope.Meta == nil {
		t.Fatalf("unexpected envelope: %#v", envelope)
	}
	var result UpdatePermissionsResult
	if err := json.Unmarshal(envelope.Data, &result); err != nil {
		t.Fatalf("decode update data: %v", err)
	}
	if result.Group.Key != permission.GroupUser || result.Group.UpdatedAt != "2026-08-20T03:04:06.123456Z" {
		t.Fatalf("unexpected update data: %#v", result)
	}
	if service.updateCalls != 1 || service.updateActor.ID != actor.ID {
		t.Fatalf("service actor = %#v after %d calls", service.updateActor, service.updateCalls)
	}
	if service.updateInput.GroupKey != permission.GroupUser || len(service.updateInput.Permissions) != 1 || service.updateInput.ExpectedUpdatedAt != "2026-08-20T03:04:05.123456Z" {
		t.Fatalf("service input = %#v", service.updateInput)
	}
}

// TestHandlerUpdatePermissionsRejectsInvalidJSON verifies malformed input is rejected before service use.
func TestHandlerUpdatePermissionsRejectsInvalidJSON(t *testing.T) {
	service := &fakeUserGroupService{}
	handler := NewHandler(service, nil)
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader("{"))

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
	envelope := decodeHandlerEnvelope(t, response)
	if response.Code != http.StatusOK || envelope.Code != CodeInvalidRequest || service.updateCalls != 0 {
		t.Fatalf("status=%d code=%d calls=%d, want 200,%d,0", response.Code, envelope.Code, service.updateCalls, CodeInvalidRequest)
	}
}

// TestHandlerUpdatePermissionsRejectsTrailingJSONAndOversizedBodies verifies request framing limits.
func TestHandlerUpdatePermissionsRejectsTrailingJSONAndOversizedBodies(t *testing.T) {
	validBody := `{"groupKey":"user","permissions":[],"expectedUpdatedAt":"2026-08-20T03:04:05Z"}`
	tests := []struct {
		name string
		body string
	}{
		{name: "trailing JSON", body: validBody + `{}`},
		{name: "oversized", body: `{"groupKey":"` + strings.Repeat("x", 70<<10) + `","permissions":[],"expectedUpdatedAt":"2026-08-20T03:04:05Z"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeUserGroupService{}
			handler := NewHandler(service, nil)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader(test.body))

			response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
			envelope := decodeHandlerEnvelope(t, response)
			if response.Code != http.StatusOK || envelope.Code != CodeInvalidRequest || service.updateCalls != 0 {
				t.Fatalf("status=%d code=%d update calls=%d, want 200,%d,0", response.Code, envelope.Code, service.updateCalls, CodeInvalidRequest)
			}
		})
	}
}

// TestHandlerUpdatePermissionsRejectsMissingOrNullPermissionsArray verifies the complete-array contract.
func TestHandlerUpdatePermissionsRejectsMissingOrNullPermissionsArray(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "missing", body: `{"groupKey":"user","expectedUpdatedAt":"2026-08-20T03:04:05Z"}`},
		{name: "null", body: `{"groupKey":"user","permissions":null,"expectedUpdatedAt":"2026-08-20T03:04:05Z"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queries := &fakeGroupQueries{}
			handler := NewHandler(testService(queries, adminResolver()), nil)
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader(test.body))

			response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
			envelope := decodeHandlerEnvelope(t, response)
			if response.Code != http.StatusOK || envelope.Code != CodeInvalidRequest || queries.updateCalls != 0 {
				t.Fatalf("status=%d code=%d update calls=%d, want 200,%d,0", response.Code, envelope.Code, queries.updateCalls, CodeInvalidRequest)
			}
		})
	}
}

// TestHandlerMapsAllUserGroupErrors verifies public codes and infrastructure logging boundaries.
func TestHandlerMapsAllUserGroupErrors(t *testing.T) {
	tests := []struct {
		name          string
		err           error
		httpStatus    int
		code          int
		errorCategory string
	}{
		{name: "invalid", err: ErrInvalidInput, httpStatus: http.StatusOK, code: CodeInvalidRequest},
		{name: "permission denied", err: ErrPermissionDenied, httpStatus: http.StatusOK, code: CodePermissionDenied},
		{name: "not found", err: ErrUserGroupNotFound, httpStatus: http.StatusOK, code: CodeUserGroupNotFound},
		{name: "conflict", err: ErrPermissionConflict, httpStatus: http.StatusOK, code: CodePermissionConflict},
		{name: "protected", err: ErrProtectedPermission, httpStatus: http.StatusOK, code: CodeProtectedPermission},
		{name: "resolver missing", err: ErrPermissionResolverNeeded, httpStatus: http.StatusInternalServerError, code: CodeInternalServerError, errorCategory: "permission_resolver"},
		{name: "database", err: errTestInfrastructure, httpStatus: http.StatusInternalServerError, code: CodeInternalServerError, errorCategory: "infrastructure"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			service := &fakeUserGroupService{updateErr: test.err}
			var logs bytes.Buffer
			handler := NewHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader(`{
				"groupKey":"user",
				"permissions":["permission-not-for-logs"],
				"expectedUpdatedAt":"2026-08-20T03:04:05Z"
			}`))
			response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), auth.CurrentUser{ID: "admin-sensitive-id", GroupKey: permission.GroupAdmin}, request)
			envelope := decodeHandlerEnvelope(t, response)
			if response.Code != test.httpStatus || envelope.Code != test.code || envelope.Meta == nil {
				t.Fatalf("status=%d code=%d meta=%#v, want %d,%d,non-nil", response.Code, envelope.Code, envelope.Meta, test.httpStatus, test.code)
			}
			if test.httpStatus == http.StatusInternalServerError {
				logOutput := logs.String()
				var entry struct {
					ActorID       string `json:"actor_id"`
					GroupKey      string `json:"group_key"`
					ErrorCategory string `json:"error_category"`
					ErrorType     string `json:"error_type"`
				}
				if err := json.Unmarshal(logs.Bytes(), &entry); err != nil {
					t.Fatalf("decode infrastructure log %q: %v", logOutput, err)
				}
				if entry.ActorID != "admin-sensitive-id" || entry.GroupKey != permission.GroupUser || entry.ErrorCategory != test.errorCategory || entry.ErrorType != fmt.Sprintf("%T", test.err) {
					t.Fatalf("infrastructure log fields = %#v, want actor_id=%q group_key=%q error_category=%q error_type=%q", entry, "admin-sensitive-id", permission.GroupUser, test.errorCategory, fmt.Sprintf("%T", test.err))
				}
				for _, forbidden := range []string{"session-secret-value", "permission-not-for-logs", "permissions", errTestInfrastructure.Error()} {
					if strings.Contains(logOutput, forbidden) {
						t.Fatalf("infrastructure log leaked %q: %s", forbidden, logOutput)
					}
				}
			} else if logs.Len() != 0 {
				t.Fatalf("business error produced infrastructure log: %s", logs.String())
			}
		})
	}
}

// TestHandlerInfrastructureLogOmitsUnvalidatedGroupKey verifies untrusted group keys are not logged.
func TestHandlerInfrastructureLogOmitsUnvalidatedGroupKey(t *testing.T) {
	service := &fakeUserGroupService{updateErr: errTestInfrastructure}
	var logs bytes.Buffer
	handler := NewHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user-group/update-permissions", strings.NewReader(`{
		"groupKey":"untrusted-secret-group",
		"permissions":[],
		"expectedUpdatedAt":"2026-08-20T03:04:05Z"
	}`))

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.UpdatePermissions), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
	envelope := decodeHandlerEnvelope(t, response)
	if response.Code != http.StatusInternalServerError || envelope.Code != CodeInternalServerError {
		t.Fatalf("status=%d code=%d, want 500,%d", response.Code, envelope.Code, CodeInternalServerError)
	}
	if logOutput := logs.String(); strings.Contains(logOutput, "untrusted-secret-group") || strings.Contains(logOutput, "group_key") {
		t.Fatalf("infrastructure log included unvalidated group key: %s", logOutput)
	}
}

// TestHandlerListLogsInfrastructureWithoutUpdateGroupKey verifies list failures omit update-only fields.
func TestHandlerListLogsInfrastructureWithoutUpdateGroupKey(t *testing.T) {
	service := &fakeUserGroupService{listErr: errTestInfrastructure}
	var logs bytes.Buffer
	handler := NewHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user-group/list", nil)

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.List), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
	envelope := decodeHandlerEnvelope(t, response)
	if response.Code != http.StatusInternalServerError || envelope.Code != CodeInternalServerError {
		t.Fatalf("status=%d code=%d, want 500,%d", response.Code, envelope.Code, CodeInternalServerError)
	}
	if logOutput := logs.String(); !strings.Contains(logOutput, "admin-id") || strings.Contains(logOutput, "group_key") {
		t.Fatalf("unexpected list infrastructure log: %s", logOutput)
	}
}

// TestHandlerEncodingFailureUsesSafeInternalEnvelope verifies encoding failures return the fallback envelope.
func TestHandlerEncodingFailureUsesSafeInternalEnvelope(t *testing.T) {
	encodingErr := errors.New("encoding unavailable")
	originalEncode := encodeResponse
	encodeResponse = func(io.Writer, response) error {
		return encodingErr
	}
	t.Cleanup(func() { encodeResponse = originalEncode })
	var logs bytes.Buffer
	handler := NewHandler(&fakeUserGroupService{}, slog.New(slog.NewJSONHandler(&logs, nil)))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user-group/list", nil)

	response := serveUserGroupHandler(t, http.HandlerFunc(handler.List), auth.CurrentUser{ID: "admin-id", GroupKey: permission.GroupAdmin}, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", response.Code)
	}
	var envelope struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode fallback response: %v", err)
	}
	if envelope.Code != CodeInternalServerError || !strings.Contains(logs.String(), "response_encoding") || !strings.Contains(logs.String(), "admin-id") || !strings.Contains(logs.String(), fmt.Sprintf(`"error_type":"%T"`, encodingErr)) {
		t.Fatalf("fallback code=%d logs=%q", envelope.Code, logs.String())
	}
}

// TestHandlerErrorCodesMatchFrontendContract verifies both layers use the checked-in user-group error-code contract.
func TestHandlerErrorCodesMatchFrontendContract(t *testing.T) {
	contents, err := os.ReadFile(filepath.Join("..", "..", "web", "src", "test", "fixtures", "user-group-error-codes.json"))
	if err != nil {
		t.Fatalf("read frontend user-group error-code contract: %v", err)
	}
	var contract struct {
		InvalidRequest     int `json:"invalidRequest"`
		PermissionConflict int `json:"permissionConflict"`
	}
	if err := json.Unmarshal(contents, &contract); err != nil {
		t.Fatalf("decode frontend user-group error-code contract: %v", err)
	}
	if contract.InvalidRequest != CodeInvalidRequest || contract.PermissionConflict != CodePermissionConflict {
		t.Fatalf("frontend error-code contract = %#v, want invalid=%d conflict=%d", contract, CodeInvalidRequest, CodePermissionConflict)
	}
}
