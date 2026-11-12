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

// AllowlistHandler keeps the optional policy outside every legacy settings DTO.
type AllowlistHandler struct {
	service AllowlistPort
	logger  *slog.Logger
}

// NewAllowlistHandler binds current-authorized reads and complete replacements.
func NewAllowlistHandler(service AllowlistPort, logger *slog.Logger) *AllowlistHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &AllowlistHandler{service: service, logger: logger}
}

// Get serves only the independent no-store resource, without query parameters.
func (h *AllowlistHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, AllowlistSettings{}, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update rejects incomplete, oversized or incorrectly framed JSON commands.
func (h *AllowlistHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, AllowlistSettings{}, ErrInvalidInput)
		return
	}
	input, err := decodeAllowlistUpdate(r.Body)
	if err != nil {
		h.respond(w, r, AllowlistSettings{}, err)
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond logs request identity only; raw errors may contain private host data.
func (h *AllowlistHandler) respond(w http.ResponseWriter, r *http.Request, result AllowlistSettings, err error) {
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
			code, message = CodeAllowlistInvalidInput, "Invalid target host allowlist"
		case errors.Is(err, ErrConflict):
			code, message = CodeAllowlistConflict, "Target host allowlist conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_host_allowlist_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
