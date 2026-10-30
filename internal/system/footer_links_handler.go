package system

import (
	"context"
	"errors"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

const (
	CodeInvalidFooterLinks  = 900208
	CodeFooterLinksConflict = 900209
)

type FooterLinksPort interface {
	PublicFooterLinks(context.Context) (FooterLinks, error)
	GetFooterLinks(context.Context, auth.CurrentUser) (FooterLinksSettings, error)
	UpdateFooterLinks(context.Context, auth.CurrentUser, UpdateFooterLinksInput) (FooterLinksSettings, error)
}

type FooterLinksHandler struct {
	service FooterLinksPort
	logger  *slog.Logger
}

// NewFooterLinksHandler uses the supplied service boundary and falls back to
// the default logger; request failures never log administrator link contents.
func NewFooterLinksHandler(service FooterLinksPort, logger *slog.Logger) *FooterLinksHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &FooterLinksHandler{service: service, logger: logger}
}

// Public exposes only the canonical navigation list, never its management revision.
func (h *FooterLinksHandler) Public(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.PublicFooterLinks(r.Context())
	if err != nil {
		h.writeError(w, r, "public", err)
		return
	}
	ok(w, content)
}

// Get delegates current database authorization and retains the complete CAS version.
func (h *FooterLinksHandler) Get(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.GetFooterLinks(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, "get", err)
		return
	}
	ok(w, content)
}

// Update rejects non-JSON media and malformed documents before a mutation can
// reach the service; the service owns current authorization, CAS and atomic audit.
func (h *FooterLinksHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		h.writeError(w, r, "update", ErrInvalidFooterLinks)
		return
	}
	input, err := decodeFooterLinksUpdate(r.Body)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	content, err := h.service.UpdateFooterLinks(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	ok(w, content)
}

// writeError logs no labels, URLs, body content or raw database error details.
func (h *FooterLinksHandler) writeError(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrSettingsPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrInvalidFooterLinks):
		businessError(w, CodeInvalidFooterLinks, "Invalid footer links")
	case errors.Is(err, ErrFooterLinksConflict):
		businessError(w, CodeFooterLinksConflict, "Footer links conflict")
	default:
		h.logger.ErrorContext(r.Context(), "footer_links_request_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "operation", op)
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
