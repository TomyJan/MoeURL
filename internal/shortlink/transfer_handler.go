package shortlink

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

// TransferPort isolates the administrative ownership operation from personal link APIs.
type TransferPort interface {
	Transfer(context.Context, auth.CurrentUser, TransferInput) (TransferResult, error)
}

// TransferHandler strictly decodes one handoff and emits redacted infrastructure diagnostics.
type TransferHandler struct {
	service TransferPort
	logger  *slog.Logger
}

// NewTransferHandler constructs the endpoint with the application's structured logger.
func NewTransferHandler(service TransferPort, logger *slog.Logger) *TransferHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &TransferHandler{service, logger}
}

// Transfer accepts only one complete JSON document before invoking the atomic service.
func (h *TransferHandler) Transfer(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input TransferInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if input.ID == "" || input.NewOwnerUsername == "" || input.ExpectedUpdatedAt == "" {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.Transfer(r.Context(), auth.UserFromContext(r.Context()), input)
	switch {
	case err == nil:
		ok(w, result)
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrShortLinkMissing):
		businessError(w, 200104, "Short link not found")
	case errors.Is(err, ErrTransferConflict):
		businessError(w, 200116, "Short link changed")
	case errors.Is(err, ErrTransferRecipientUnavailable):
		businessError(w, 200117, "Recipient unavailable")
	default:
		category := "infrastructure"
		if errors.Is(err, context.DeadlineExceeded) {
			category = "timeout"
		} else if errors.Is(err, context.Canceled) {
			category = "canceled"
		}
		h.logger.ErrorContext(r.Context(), "short_link_transfer_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error_category", category, "error_type", fmt.Sprintf("%T", err))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
