package user

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// TimeZonePreferencePort keeps the personal HTTP document independent from persistence.
type TimeZonePreferencePort interface {
	Get(context.Context, auth.CurrentUser) (TimeZonePreferenceResult, error)
	Update(context.Context, auth.CurrentUser, UpdateTimeZonePreferenceInput) (TimeZonePreferenceResult, error)
}

// TimeZonePreferenceHandler accepts only the exact independent time-zone preference document.
type TimeZonePreferenceHandler struct {
	service TimeZonePreferencePort
	logger  *slog.Logger
}

// NewTimeZonePreferenceHandler configures redacted infrastructure diagnostics.
func NewTimeZonePreferenceHandler(service TimeZonePreferencePort, logger *slog.Logger) *TimeZonePreferenceHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &TimeZonePreferenceHandler{service: service, logger: logger}
}

// Get returns the cookie account's nullable display zone without permitting shared caching.
func (h *TimeZonePreferenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

// Update rejects non-JSON requests and non-exact, duplicate or incomplete documents before saving.
func (h *TimeZonePreferenceHandler) Update(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, err := decodeTimeZonePreferenceInput(r.Body)
	if err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// decodeTimeZonePreferenceInput preserves explicit nulls and rejects repeated decoded field names.
func decodeTimeZonePreferenceInput(body io.Reader) (UpdateTimeZonePreferenceInput, error) {
	var input UpdateTimeZonePreferenceInput
	decoder := json.NewDecoder(body)
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return input, ErrInvalidInput
	}
	seen := map[string]bool{}
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return input, ErrInvalidInput
		}
		key, ok := token.(string)
		if !ok || seen[key] {
			return input, ErrInvalidInput
		}
		seen[key] = true
		switch key {
		case "timeZone":
			err = decoder.Decode(&input.TimeZone)
		case "expectedUpdatedAt":
			err = decoder.Decode(&input.ExpectedUpdatedAt)
		default:
			return input, ErrInvalidInput
		}
		if err != nil {
			return input, ErrInvalidInput
		}
	}
	token, err = decoder.Token()
	if err != nil || token != json.Delim('}') || len(seen) != 2 {
		return input, ErrInvalidInput
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return input, ErrInvalidInput
	}
	return input, nil
}

// respond keeps business failures stable and excludes preference contents from server diagnostics.
func (h *TimeZonePreferenceHandler) respond(w http.ResponseWriter, r *http.Request, result TimeZonePreferenceResult, err error) {
	switch {
	case err == nil:
		ok(w, result)
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrPreferencesConflict):
		businessError(w, CodePreferencesConflict, "Preferences changed")
	default:
		h.logger.ErrorContext(r.Context(), "time_zone_preference_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error_type", fmt.Sprintf("%T", err))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
