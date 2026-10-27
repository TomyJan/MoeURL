package domain

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/url"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// RedirectDefaultPort keeps new projections separate from the legacy domain contract.
type RedirectDefaultPort interface {
	GetRedirectDefault(context.Context, auth.CurrentUser, string) (RedirectDefaultSetting, error)
	SetRedirectDefault(context.Context, auth.CurrentUser, SetRedirectDefaultInput) (RedirectDefaultSetting, error)
	RedirectDefaults(context.Context, auth.CurrentUser) ([]EffectiveRedirectDefault, error)
}

// RedirectDefaultHandler validates explicit commands without widening old DTOs.
type RedirectDefaultHandler struct {
	service   RedirectDefaultPort
	responses *Handler
}

// NewRedirectDefaultHandler shares only the existing sanitized domain response boundary.
func NewRedirectDefaultHandler(service RedirectDefaultPort, logger *slog.Logger) *RedirectDefaultHandler {
	return &RedirectDefaultHandler{service: service, responses: NewHandler(nil, logger)}
}

// Get reads exactly one canonical target under current database management authority.
func (h *RedirectDefaultHandler) Get(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	query, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(query) != 1 || len(query["id"]) != 1 || query.Get("id") == "" {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.GetRedirectDefault(r.Context(), auth.UserFromContext(r.Context()), query.Get("id"))
	if err != nil {
		h.responses.writeError(w, r, err)
		return
	}
	ok(w, map[string]RedirectDefaultSetting{"setting": result})
}

// Set accepts one complete JSON command, including explicit rejection of duplicate keys.
func (h *RedirectDefaultHandler) Set(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, err := decodeRedirectDefaultCommand(r.Body)
	if err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.SetRedirectDefault(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.responses.writeError(w, r, err)
		return
	}
	ok(w, map[string]RedirectDefaultSetting{"setting": result})
}

// Available returns only effective defaults for the authenticated actor and accepts no filters.
func (h *RedirectDefaultHandler) Available(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.RawQuery != "" {
		businessError(w, 100001, "Invalid request")
		return
	}
	items, err := h.service.RedirectDefaults(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.responses.writeError(w, r, err)
		return
	}
	ok(w, map[string][]EffectiveRedirectDefault{"items": items})
}

// decodeRedirectDefaultCommand preserves exact field names and rejects ambiguous duplicate values.
func decodeRedirectDefaultCommand(reader io.Reader) (SetRedirectDefaultInput, error) {
	var input SetRedirectDefaultInput
	decoder := json.NewDecoder(reader)
	token, err := decoder.Token()
	if err != nil || token != json.Delim('{') {
		return input, ErrInvalidInput
	}
	seen := make(map[string]bool, 3)
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
		var destination *string
		switch key {
		case "id":
			destination = &input.ID
		case "redirectMode":
			destination = &input.RedirectMode
		case "expectedUpdatedAt":
			destination = &input.ExpectedUpdatedAt
		default:
			return input, ErrInvalidInput
		}
		if err := decoder.Decode(destination); err != nil || *destination == "" {
			return input, ErrInvalidInput
		}
	}
	token, err = decoder.Token()
	if err != nil || token != json.Delim('}') || len(seen) != 3 {
		return input, ErrInvalidInput
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return input, ErrInvalidInput
	}
	return input, nil
}
