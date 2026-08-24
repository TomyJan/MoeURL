package usergroup

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
)

const (
	// maxUpdatePermissionsBodyBytes bounds pre-authorization request decoding.
	maxUpdatePermissionsBodyBytes = 64 << 10
	// CodeInvalidRequest identifies invalid user-group input.
	CodeInvalidRequest = 100001
	// CodePermissionDenied identifies missing administrative access.
	CodePermissionDenied = 120001
	// CodeUserGroupNotFound identifies a missing built-in user group.
	CodeUserGroupNotFound = 300201
	// CodePermissionConflict identifies a stale optimistic concurrency value.
	CodePermissionConflict = 300202
	// CodeProtectedPermission identifies a protected permission change.
	CodeProtectedPermission = 300203
	// CodeInternalServerError identifies infrastructure failures.
	CodeInternalServerError = 900000
)

// Handler serves user-group management HTTP endpoints.
type Handler struct {
	service Port
	logger  *slog.Logger
}

// response is the unified user-group API envelope.
type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// encodeResponse serializes one response into a staging buffer.
var encodeResponse = func(writer io.Writer, body response) error {
	return json.NewEncoder(writer).Encode(body)
}

// NewHandler creates a user-group handler with safe logger fallback.
func NewHandler(service Port, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, logger: logger}
}

// List returns the built-in user groups and permission catalog.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	actor := auth.UserFromContext(r.Context())
	result, err := h.service.List(r.Context(), actor)
	if err != nil {
		h.writeError(w, r, actor, "", err)
		return
	}
	h.writeResponse(w, r, actor, "", http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

// UpdatePermissions validates and submits one permission update.
func (h *Handler) UpdatePermissions(w http.ResponseWriter, r *http.Request) {
	var input UpdatePermissionsInput
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxUpdatePermissionsBodyBytes))
	if err := decoder.Decode(&input); err != nil {
		h.writeResponse(w, r, auth.UserFromContext(r.Context()), "", http.StatusOK, response{
			Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{},
		})
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		h.writeResponse(w, r, auth.UserFromContext(r.Context()), "", http.StatusOK, response{
			Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{},
		})
		return
	}

	actor := auth.UserFromContext(r.Context())
	result, err := h.service.UpdatePermissions(r.Context(), actor, input)
	if err != nil {
		h.writeError(w, r, actor, input.GroupKey, err)
		return
	}
	h.writeResponse(w, r, actor, input.GroupKey, http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

// writeError maps service errors to business or infrastructure responses.
func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, actor auth.CurrentUser, groupKey string, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		h.writeResponse(w, r, actor, groupKey, http.StatusOK, response{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
	case errors.Is(err, ErrPermissionDenied):
		h.writeResponse(w, r, actor, groupKey, http.StatusOK, response{Code: CodePermissionDenied, Message: "Permission denied", Data: nil, Meta: map[string]any{}})
	case errors.Is(err, ErrUserGroupNotFound):
		h.writeResponse(w, r, actor, groupKey, http.StatusOK, response{Code: CodeUserGroupNotFound, Message: "User group not found", Data: nil, Meta: map[string]any{}})
	case errors.Is(err, ErrPermissionConflict):
		h.writeResponse(w, r, actor, groupKey, http.StatusOK, response{Code: CodePermissionConflict, Message: "Permission conflict", Data: nil, Meta: map[string]any{}})
	case errors.Is(err, ErrProtectedPermission):
		h.writeResponse(w, r, actor, groupKey, http.StatusOK, response{Code: CodeProtectedPermission, Message: "Protected permission cannot be changed", Data: nil, Meta: map[string]any{}})
	default:
		category := "infrastructure"
		if errors.Is(err, ErrPermissionResolverNeeded) {
			category = "permission_resolver"
		}
		h.logInfrastructure(r, actor, groupKey, category, err)
		h.writeResponse(w, r, actor, groupKey, http.StatusInternalServerError, response{Code: CodeInternalServerError, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}

// writeResponse stages JSON before committing headers and provides a static fallback.
func (h *Handler) writeResponse(w http.ResponseWriter, r *http.Request, actor auth.CurrentUser, groupKey string, status int, body response) {
	var buffer bytes.Buffer
	if err := encodeResponse(&buffer, body); err != nil {
		h.logInfrastructure(r, actor, groupKey, "response_encoding", err)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"code":900000,"message":"Internal server error","data":null,"meta":{}}` + "\n"))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}

// logInfrastructure records bounded request identity, a stable category, and the diagnostic error type.
func (h *Handler) logInfrastructure(r *http.Request, actor auth.CurrentUser, groupKey string, category string, err error) {
	attributes := []any{
		"actor_id", actor.ID,
		"error_category", category,
		"error_type", fmt.Sprintf("%T", err),
	}
	if groupKey = stableGroupKey(groupKey); groupKey != "" {
		attributes = append(attributes, "group_key", groupKey)
	}
	h.logger.ErrorContext(r.Context(), "user_group_request_failed", attributes...)
}

// stableGroupKey returns only fixed built-in identifiers that are safe to log.
func stableGroupKey(groupKey string) string {
	switch groupKey {
	case permission.GroupGuest, permission.GroupUser, permission.GroupAdmin:
		return groupKey
	default:
		return ""
	}
}
