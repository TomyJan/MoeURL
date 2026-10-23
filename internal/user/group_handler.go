package user

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// GroupPort isolates the privileged membership operation from existing profile APIs.
type GroupPort interface {
	ChangeGroup(context.Context, auth.CurrentUser, ChangeGroupInput) (UpdateResult, error)
}

type GroupHandler struct {
	service GroupPort
	logger  *slog.Logger
}

// NewGroupHandler constructs the strict membership endpoint with redacted diagnostics.
func NewGroupHandler(service GroupPort, logger *slog.Logger) *GroupHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &GroupHandler{service, logger}
}

// Change accepts a single explicit JSON document before invoking the atomic service.
func (h *GroupHandler) Change(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input ChangeGroupInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if input.ID == "" || input.GroupKey == "" || input.ExpectedUpdatedAt == "" {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.ChangeGroup(r.Context(), auth.UserFromContext(r.Context()), input)
	switch {
	case err == nil:
		ok(w, result)
	case errors.Is(err, ErrVersionConflict):
		businessError(w, 300105, "User changed")
	case errors.Is(err, ErrSelfGroupChange):
		businessError(w, 300106, "Cannot change own group")
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrBuiltinUserImmutable):
		businessError(w, 300102, "Builtin user cannot be modified")
	case errors.Is(err, ErrUserNotFound):
		businessError(w, 300103, "User not found")
	default:
		h.logger.ErrorContext(r.Context(), "user_group_change_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
