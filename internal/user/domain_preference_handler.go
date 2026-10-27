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

// DomainPreferencePort separates the account-scoped HTTP boundary from persistence.
type DomainPreferencePort interface {
	Get(context.Context, auth.CurrentUser) (DomainPreferenceResult, error)
	Update(context.Context, auth.CurrentUser, UpdateDomainPreferenceInput) (DomainPreferenceResult, error)
}

// DomainPreferenceHandler accepts only the independent domain-preference document.
type DomainPreferenceHandler struct {
	service DomainPreferencePort
	logger  *slog.Logger
}

// NewDomainPreferenceHandler uses redacted diagnostics for infrastructure failures.
func NewDomainPreferenceHandler(service DomainPreferencePort, logger *slog.Logger) *DomainPreferenceHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &DomainPreferenceHandler{service: service, logger: logger}
}

// Get returns only the request account's stored UUID and concurrency revision.
func (h *DomainPreferenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update decodes one explicit nullable document behind a JSON-only write boundary.
func (h *DomainPreferenceHandler) Update(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var document struct {
		DomainID          json.RawMessage `json:"domainId"`
		ExpectedUpdatedAt json.RawMessage `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if len(document.DomainID) == 0 || len(document.ExpectedUpdatedAt) == 0 {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input UpdateDomainPreferenceInput
	if err := json.Unmarshal(document.DomainID, &input.DomainID); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := json.Unmarshal(document.ExpectedUpdatedAt, &input.ExpectedUpdatedAt); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond exposes stable business codes while excluding database contents from diagnostics.
func (h *DomainPreferenceHandler) respond(w http.ResponseWriter, r *http.Request, result DomainPreferenceResult, err error) {
	switch {
	case err == nil:
		ok(w, result)
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrPreferencesConflict):
		businessError(w, CodePreferencesConflict, "Preferences changed")
	default:
		h.logger.ErrorContext(r.Context(), "domain_preference_failed",
			"request_id", middleware.RequestIDFromContext(r.Context()), "error_type", fmt.Sprintf("%T", err))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
