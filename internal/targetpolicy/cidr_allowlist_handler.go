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

// CIDRAllowlistHandler keeps the optional policy outside every legacy settings DTO.
type CIDRAllowlistHandler struct {
	service CIDRAllowlistPort
	logger  *slog.Logger
}

// NewCIDRAllowlistHandler binds current-authorized reads and complete replacements.
func NewCIDRAllowlistHandler(service CIDRAllowlistPort, logger *slog.Logger) *CIDRAllowlistHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &CIDRAllowlistHandler{service: service, logger: logger}
}

// Get serves only the independent no-store resource, without query parameters.
func (h *CIDRAllowlistHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, CIDRAllowlistSettings{}, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update rejects incomplete, oversized or incorrectly framed JSON commands.
func (h *CIDRAllowlistHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, CIDRAllowlistSettings{}, ErrInvalidInput)
		return
	}
	input, err := decodeCIDRAllowlistUpdate(r.Body)
	if err != nil {
		h.respond(w, r, CIDRAllowlistSettings{}, err)
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond logs request identity only; raw errors may contain private host data.
func (h *CIDRAllowlistHandler) respond(w http.ResponseWriter, r *http.Request, result CIDRAllowlistSettings, err error) {
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
			code, message = CodeCIDRAllowlistInvalidInput, "Invalid target CIDR allowlist"
		case errors.Is(err, ErrConflict):
			code, message = CodeCIDRAllowlistConflict, "Target CIDR allowlist conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_cidr_allowlist_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
