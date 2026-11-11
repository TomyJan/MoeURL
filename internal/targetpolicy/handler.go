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

// Handler implements only the two independent administrator endpoints.
type Handler struct {
	service Port
	logger  *slog.Logger
}

// NewHandler shares request logging without exposing policy or database details.
func NewHandler(service Port, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, logger: logger}
}

// Get returns only a current-authorized policy with a no-store response.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.respond(w, r, Settings{}, ErrInvalidInput)
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update accepts a complete bounded JSON command, never partial form input.
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
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// respond never logs raw errors because they may contain policy values.
func (h *Handler) respond(w http.ResponseWriter, r *http.Request, result Settings, err error) {
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
			code, message = CodeInvalidInput, "Invalid target host policy"
		case errors.Is(err, ErrConflict):
			code, message = CodeConflict, "Target host policy conflict"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "target_host_policy_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
