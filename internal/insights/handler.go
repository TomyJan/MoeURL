package insights

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

type Handler struct {
	service Port
	logger  *slog.Logger
}

// NewHandler creates the usage read handlers with infrastructure-only diagnostics.
func NewHandler(service Port, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service, logger}
}

// Dashboard validates query syntax before serving the current administrator's global snapshot.
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	input, err := parseQuery(r.URL.RawQuery, false)
	if err != nil {
		h.respond(w, r, nil, err)
		return
	}
	result, err := h.service.Dashboard(r.Context(), auth.UserFromContext(r.Context()), input.RangeInput)
	h.respond(w, r, result, err)
}

// Visits serves owner-scoped anonymous records through the shared envelope.
func (h *Handler) Visits(w http.ResponseWriter, r *http.Request) { h.visits(w, r, false) }

// AdminVisits serves explicitly authorized administrative anonymous records.
func (h *Handler) AdminVisits(w http.ResponseWriter, r *http.Request) { h.visits(w, r, true) }

// visits keeps strict wire parsing identical for both ownership scopes.
func (h *Handler) visits(w http.ResponseWriter, r *http.Request, admin bool) {
	input, err := parseQuery(r.URL.RawQuery, true)
	if err != nil {
		h.respond(w, r, nil, err)
		return
	}
	var result VisitResult
	if admin {
		result, err = h.service.AdminVisits(r.Context(), auth.UserFromContext(r.Context()), input)
	} else {
		result, err = h.service.Visits(r.Context(), auth.UserFromContext(r.Context()), input)
	}
	h.respond(w, r, result, err)
}

// respond preserves the shared business envelope and never caches private reads.
func (h *Handler) respond(w http.ResponseWriter, r *http.Request, result any, err error) {
	code, status, message := 0, http.StatusOK, "OK"
	switch {
	case err == nil:
	case errors.Is(err, ErrInvalidInput):
		code, message = 100001, "Invalid request"
	case errors.Is(err, ErrPermissionDenied):
		code, message = 120001, "Permission denied"
	case errors.Is(err, ErrLinkMissing):
		code, message = 200104, "Short link not found"
	case errors.Is(err, ErrVisitExportLimit):
		code, message = 200120, "Visit export limit exceeded"
	case errors.Is(err, ErrAuditExportLimit):
		code, message = 100002, "Audit export limit exceeded"
	default:
		code, status, message = 900000, http.StatusInternalServerError, "Internal server error"
		h.logger.ErrorContext(r.Context(), "insight_request_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
	}
	if err != nil {
		result = nil
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    any            `json:"data"`
		Meta    map[string]any `json:"meta"`
	}{code, message, result, map[string]any{}})
}
