package createquota

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// UsageHandler exposes only the Cookie owner's private read-only snapshot.
type UsageHandler struct {
	service UsagePort
	logger  *slog.Logger
}

// NewUsageHandler uses opaque infrastructure diagnostics, never private usage.
func NewUsageHandler(service UsagePort, logger *slog.Logger) *UsageHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &UsageHandler{service: service, logger: logger}
}

// Get rejects owner selectors and stale browser identity before service I/O.
func (h *UsageHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var value Usage
	var err error
	actor := auth.UserFromContext(r.Context())
	expected, supplied := r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")]
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		err = ErrInvalidInput
	} else if _, invalid := actorID(actor.ID); invalid != nil || supplied && (len(expected) != 1 || expected[0] != actor.ID) {
		err = ErrPermissionDenied
	} else {
		value, err = h.service.GetOwnUsage(r.Context(), actor)
	}
	h.respond(w, r, value, err)
}

// respond preserves the ordinary envelope without returning infrastructure data.
func (h *UsageHandler) respond(w http.ResponseWriter, r *http.Request, value Usage, err error) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	status, code, message := 200, 0, "OK"
	var data any = value
	if err != nil {
		data = nil
		switch {
		case errors.Is(err, ErrPermissionDenied):
			code, message = 120001, "Permission denied"
		case errors.Is(err, ErrInvalidInput):
			code, message = 100001, "Invalid request"
		default:
			status, code, message = 500, 900000, "Internal server error"
			h.logger.ErrorContext(r.Context(), "own_daily_create_usage_failed", "request_id", middleware.RequestIDFromContext(r.Context()))
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
