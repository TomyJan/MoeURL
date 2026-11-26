package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

type SupplementalMembershipPort interface {
	UpdateGroupMemberships(context.Context, auth.CurrentUser, UpdateGroupMembershipsInput) (UpdateResult, error)
}

type MembershipHandler struct {
	service SupplementalMembershipPort
	logger  *slog.Logger
}

func NewMembershipHandler(service SupplementalMembershipPort, logger *slog.Logger) *MembershipHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &MembershipHandler{service: service, logger: logger}
}

// Update accepts only one complete JSON document; an explicit empty groupKeys array clears all supplemental groups.
func (h *MembershipHandler) Update(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input *UpdateGroupMembershipsInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || input == nil || input.ID == "" || input.ExpectedUpdatedAt == "" || input.GroupKeys == nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.UpdateGroupMemberships(r.Context(), auth.UserFromContext(r.Context()), *input)
	switch {
	case err == nil:
		ok(w, result)
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrUserNotFound):
		businessError(w, 300103, "User not found")
	case errors.Is(err, ErrBuiltinUserImmutable):
		businessError(w, 300102, "Builtin user cannot be modified")
	case errors.Is(err, ErrSelfGroupChange):
		businessError(w, 300106, "Cannot change own group")
	case errors.Is(err, ErrVersionConflict):
		businessError(w, 300105, "User changed")
	default:
		category := "infrastructure"
		switch {
		case errors.Is(err, context.DeadlineExceeded):
			category = "timeout"
		case errors.Is(err, context.Canceled):
			category = "canceled"
		}
		h.logger.ErrorContext(r.Context(), "user_group_membership_update_failed",
			"request_id", middleware.RequestIDFromContext(r.Context()),
			"error_category", category, "error_type", fmt.Sprintf("%T", err))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
