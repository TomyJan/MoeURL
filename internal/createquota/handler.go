package createquota

import (
	"encoding/json"
	"errors"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// Handler serves only the separate current-authorized quota policy resource.
type Handler struct {
	service Port
	logger  *slog.Logger
}

// NewHandler uses opaque infrastructure diagnostics that cannot leak settings.
func NewHandler(service Port, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, logger: logger}
}

// Get rejects query parameters and returns a no-store independent document.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, Settings{}, ErrInvalidInput)
		return
	}
	value, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, value, err)
}

// Update accepts one bounded complete JSON replacement, never a partial patch.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, Settings{}, ErrInvalidInput)
		return
	}
	input, err := decodeUpdate(r.Body)
	if err != nil {
		h.respond(w, r, Settings{}, err)
		return
	}
	value, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, value, err)
}

// respond exposes business codes and logs request identity only on failures.
func (h *Handler) respond(w http.ResponseWriter, r *http.Request, value Settings, err error) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	status, code, message := 200, 0, "OK"
	var data any = value
	if err != nil {
		data = nil
		switch {
		case errors.Is(err, ErrPermissionDenied):
			code, message = 120001, "Permission denied"
		case errors.Is(err, ErrInvalidInput):
			code, message = CodeInvalidInput, "Invalid daily create quota"
		case errors.Is(err, ErrConflict):
			code, message = CodeConflict, "Daily create quota conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "daily_create_quota_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
