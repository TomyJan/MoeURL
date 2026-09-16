package domain

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	CodePermissionDenied = 120001
	CodeDomainConflict   = 210101
	CodeDomainNotFound   = 210102
	CodeVersionConflict  = 210103
	CodeDomainReferenced = 210104
	CodeDomainProtected  = 210105
)

// Port is the domain service contract used by HTTP routes.
type Port interface {
	List(context.Context, auth.CurrentUser) (ListResult, error)
	Available(context.Context, auth.CurrentUser) (AvailableResult, error)
	Create(context.Context, auth.CurrentUser, CreateInput) (Domain, error)
	Update(context.Context, auth.CurrentUser, UpdateInput) (Domain, error)
	SetDefault(context.Context, auth.CurrentUser, ChangeInput) (Domain, error)
	Delete(context.Context, auth.CurrentUser, ChangeInput) error
}

type Handler struct {
	service Port
	logger  *slog.Logger
}

// NewHandler creates a domain handler with sanitized infrastructure logging.
func NewHandler(service Port, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, logger: logger}
}

// List returns the complete managed-domain view for an authorized administrator.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.List(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, result)
}

// Available returns the enabled domains the current user may select for a short link.
func (h *Handler) Available(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Available(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, result)
}

// Create validates one management request and returns the newly registered domain.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateInput
	if !decodeInput(w, r, &input) {
		return
	}
	result, err := h.service.Create(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, map[string]Domain{"domain": result})
}

// Update applies an optimistic domain change and returns the refreshed representation.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input UpdateInput
	if !decodeInput(w, r, &input) {
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, map[string]Domain{"domain": result})
}

// SetDefault atomically selects the requested domain as the global short-link default.
func (h *Handler) SetDefault(w http.ResponseWriter, r *http.Request) {
	var input ChangeInput
	if !decodeInput(w, r, &input) {
		return
	}
	result, err := h.service.SetDefault(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, map[string]Domain{"domain": result})
}

// Delete removes an unreferenced non-default domain using optimistic concurrency.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	var input ChangeInput
	if !decodeInput(w, r, &input) {
		return
	}
	if err := h.service.Delete(r.Context(), auth.UserFromContext(r.Context()), input); err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, map[string]bool{"deleted": true})
}

// decodeInput parses one JSON request body and emits the standard invalid-request response on failure.
func decodeInput(w http.ResponseWriter, r *http.Request, target any) bool {
	if err := json.NewDecoder(r.Body).Decode(target); err != nil {
		businessError(w, 100001, "Invalid request")
		return false
	}
	return true
}

// writeError maps domain errors to stable business responses and sanitizes infrastructure failures.
func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, CodePermissionDenied, "Permission denied")
	case errors.Is(err, ErrInvalidInput), errors.Is(err, ErrInvalidOrigin):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrDomainConflict):
		businessError(w, CodeDomainConflict, "Domain already exists")
	case errors.Is(err, ErrDomainNotFound):
		businessError(w, CodeDomainNotFound, "Domain not found")
	case errors.Is(err, ErrVersionConflict):
		businessError(w, CodeVersionConflict, "Domain was changed")
	case errors.Is(err, ErrDomainReferenced):
		businessError(w, CodeDomainReferenced, "Domain is in use")
	case errors.Is(err, ErrDomainProtected):
		businessError(w, CodeDomainProtected, "Default domain must remain enabled")
	default:
		category := "unknown"
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			category = "database"
		} else if errors.Is(err, context.DeadlineExceeded) {
			category = "timeout"
		}
		h.logger.ErrorContext(r.Context(), "domain_request_failed",
			"request_id", middleware.RequestIDFromContext(r.Context()), "error_category", category)
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// ok writes the standard successful API envelope.
func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

// businessError writes a domain business failure using the HTTP 200 API contract.
func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeJSON serializes one response envelope with the requested HTTP status.
func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
