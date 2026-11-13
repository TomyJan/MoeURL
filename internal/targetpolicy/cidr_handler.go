package targetpolicy

import (
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// CIDRHandler keeps the CIDR resource out of every legacy DTO.
type CIDRHandler struct {
	service CIDRPort
	logger  *slog.Logger
}

// NewCIDRHandler binds complete replacements and current-authorized reads.
func NewCIDRHandler(service CIDRPort, logger *slog.Logger) *CIDRHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &CIDRHandler{service: service, logger: logger}
}

// Get accepts no query parameters and never caches private prefixes.
func (h *CIDRHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, CIDRSettings{}, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update rejects ambiguous framing before passing a complete command to storage.
func (h *CIDRHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, CIDRSettings{}, ErrInvalidInput)
		return
	}
	input, err := decodeCIDRUpdate(r.Body)
	if err != nil {
		h.respond(w, r, CIDRSettings{}, err)
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond sanitizes infrastructure failures instead of logging private values.
func (h *CIDRHandler) respond(w http.ResponseWriter, r *http.Request, result CIDRSettings, err error) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	status, code, message := 200, 0, "OK"
	var data any = result
	if err != nil {
		data = nil
		switch {
		case errors.Is(err, ErrPermissionDenied):
			code, message = 120001, "Permission denied"
		case errors.Is(err, ErrInvalidInput):
			code, message = CodeCIDRInvalidInput, "Invalid target CIDR denylist"
		case errors.Is(err, ErrConflict):
			code, message = CodeCIDRConflict, "Target CIDR denylist conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_cidr_denylist_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
		}
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
		Data    any    `json:"data"`
		Meta    any    `json:"meta"`
	}{code, message, data, map[string]any{}})
}
