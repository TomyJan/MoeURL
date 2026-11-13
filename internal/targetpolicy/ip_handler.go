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

// IPHandler keeps the literal-address resource out of every legacy DTO.
type IPHandler struct {
	service IPPort
	logger  *slog.Logger
}

// NewIPHandler binds complete replacements and current-authorized reads.
func NewIPHandler(service IPPort, logger *slog.Logger) *IPHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &IPHandler{service: service, logger: logger}
}

// Get accepts no query parameters and never caches private addresses.
func (h *IPHandler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, IPSettings{}, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update rejects ambiguous framing before passing a complete command to storage.
func (h *IPHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, IPSettings{}, ErrInvalidInput)
		return
	}
	input, err := decodeIPUpdate(r.Body)
	if err != nil {
		h.respond(w, r, IPSettings{}, err)
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond sanitizes infrastructure failures instead of logging private values.
func (h *IPHandler) respond(w http.ResponseWriter, r *http.Request, result IPSettings, err error) {
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
			code, message = CodeIPInvalidInput, "Invalid target IP denylist"
		case errors.Is(err, ErrConflict):
			code, message = CodeIPConflict, "Target IP denylist conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_ip_denylist_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
