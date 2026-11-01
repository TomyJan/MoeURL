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

type RedirectPreferencePort interface {
	Get(context.Context, auth.CurrentUser) (RedirectPreferenceResult, error)
	Update(context.Context, auth.CurrentUser, UpdateRedirectPreferenceInput) (RedirectPreferenceResult, error)
}

type RedirectPreferenceHandler struct {
	service RedirectPreferencePort
	logger  *slog.Logger
}

func NewRedirectPreferenceHandler(service RedirectPreferencePort, logger *slog.Logger) *RedirectPreferenceHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &RedirectPreferenceHandler{service: service, logger: logger}
}

func (h *RedirectPreferenceHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" || r.URL.ForceQuery {
		businessError(w, 100001, "Invalid request")
		return
	}
	if !redirectPreferenceOwnerMatches(r) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	h.respond(w, r, result, err)
}

func (h *RedirectPreferenceHandler) Update(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, err := decodeRedirectPreferenceInput(http.MaxBytesReader(w, r.Body, 8<<10))
	if err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if !redirectPreferenceOwnerMatches(r) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.respond(w, r, result, err)
}

// Browser callers bind a stale tab's intent to its captured account. The Cookie
// still chooses the sole resource owner; body-only API callers retain current-self semantics.
func redirectPreferenceOwnerMatches(r *http.Request) bool {
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	return len(expected) == 0 || len(expected) == 1 && expected[0] == auth.UserFromContext(r.Context()).ID
}

// Decode token by token so duplicate decoded keys and case aliases cannot masquerade as a valid document.
func decodeRedirectPreferenceInput(body io.Reader) (UpdateRedirectPreferenceInput, error) {
	var input UpdateRedirectPreferenceInput
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
		case "redirectMode":
			err = decoder.Decode(&input.RedirectMode)
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

func (h *RedirectPreferenceHandler) respond(w http.ResponseWriter, r *http.Request, result RedirectPreferenceResult, err error) {
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
		h.logger.ErrorContext(r.Context(), "redirect_preference_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error_type", fmt.Sprintf("%T", err))
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
