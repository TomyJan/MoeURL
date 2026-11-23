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
)

const maxCustomGroupBodyBytes = 64 << 10

type CustomHandler struct {
	service CustomPort
	logger  *slog.Logger
}

func NewCustomHandler(service CustomPort, logger *slog.Logger) *CustomHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &CustomHandler{service: service, logger: logger}
}

func (h *CustomHandler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateCustomGroupInput
	if !decodeCustomGroupJSON(w, r, &input) {
		h.write(w, http.StatusOK, response{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.service.Create(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.write(w, http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

func (h *CustomHandler) UpdateDetails(w http.ResponseWriter, r *http.Request) {
	var input UpdateCustomGroupDetailsInput
	if !decodeCustomGroupJSON(w, r, &input) {
		h.write(w, http.StatusOK, response{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.service.UpdateDetails(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.write(w, http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

func (h *CustomHandler) UpdatePermissions(w http.ResponseWriter, r *http.Request) {
	var input UpdatePermissionsInput
	if !decodeCustomGroupJSON(w, r, &input) {
		h.write(w, http.StatusOK, response{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.service.UpdatePermissions(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.write(w, http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

func (h *CustomHandler) Delete(w http.ResponseWriter, r *http.Request) {
	var input DeleteCustomGroupInput
	if !decodeCustomGroupJSON(w, r, &input) {
		h.write(w, http.StatusOK, response{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.service.Delete(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	h.write(w, http.StatusOK, response{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

func decodeCustomGroupJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxCustomGroupBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false
	}
	return errors.Is(decoder.Decode(&struct{}{}), io.EOF)
}

func (h *CustomHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	status, code, message := http.StatusOK, CodeInvalidRequest, "Invalid request"
	switch {
	case errors.Is(err, ErrPermissionDenied):
		code, message = CodePermissionDenied, "Permission denied"
	case errors.Is(err, ErrUserGroupNotFound):
		code, message = CodeUserGroupNotFound, "User group not found"
	case errors.Is(err, ErrPermissionConflict):
		code, message = CodePermissionConflict, "User group conflict"
	case errors.Is(err, ErrProtectedPermission):
		code, message = CodeProtectedPermission, "Protected permission cannot be changed"
	case errors.Is(err, ErrUserGroupNameConflict):
		code, message = CodeUserGroupNameConflict, "User group name already exists"
	case errors.Is(err, ErrUserGroupHasMembers):
		code, message = CodeUserGroupHasMembers, "User group still has members"
	case errors.Is(err, ErrProtectedGroup):
		code, message = CodeProtectedGroup, "Built-in user groups cannot be changed"
	default:
		status, code, message = http.StatusInternalServerError, CodeInternalServerError, "Internal server error"
		h.logger.ErrorContext(r.Context(), "custom_user_group_request_failed", "actor_id", auth.UserFromContext(r.Context()).ID, "error_type", fmt.Sprintf("%T", err))
	}
	h.write(w, status, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

func (h *CustomHandler) write(w http.ResponseWriter, status int, body response) {
	var buffer bytes.Buffer
	if err := encodeResponse(&buffer, body); err != nil {
		status = http.StatusInternalServerError
		buffer.Reset()
		_, _ = buffer.WriteString(`{"code":900000,"message":"Internal server error","data":null,"meta":{}}` + "\n")
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}
