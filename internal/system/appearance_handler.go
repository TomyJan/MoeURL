package system

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

const (
	CodeInvalidAppearance  = 900206
	CodeAppearanceConflict = 900207
)

// AppearancePort keeps public appearance and independent management revisions separate.
type AppearancePort interface {
	PublicAppearance(context.Context) (Appearance, error)
	GetAppearance(context.Context, auth.CurrentUser) (AppearanceSettings, error)
	UpdateAppearance(context.Context, auth.CurrentUser, UpdateAppearanceInput) (AppearanceSettings, error)
}

// AppearanceHandler implements only the three independent appearance endpoints.
type AppearanceHandler struct {
	service AppearancePort
	logger  *slog.Logger
}

// NewAppearanceHandler uses the application's request logger when provided.
func NewAppearanceHandler(service AppearancePort, logger *slog.Logger) *AppearanceHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &AppearanceHandler{service: service, logger: logger}
}

// Public returns only the public preset, without a management token.
func (h *AppearanceHandler) Public(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.PublicAppearance(r.Context())
	if err != nil {
		h.writeError(w, r, "public", err)
		return
	}
	ok(w, content)
}

// Get returns a current-authorized management projection.
func (h *AppearanceHandler) Get(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.GetAppearance(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, "get", err)
		return
	}
	ok(w, content)
}

// Update requires a complete bounded UTF8 JSON document before business writes.
func (h *AppearanceHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		h.writeError(w, r, "update", ErrInvalidAppearance)
		return
	}
	input, err := decodeAppearance(r.Body)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	content, err := h.service.UpdateAppearance(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	ok(w, content)
}

// decodeAppearance preserves the full version string and rejects malformed
// requests without passing a partial command through to persistence.
func decodeAppearance(body io.Reader) (UpdateAppearanceInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 8193))
	if err != nil || len(raw) > 8192 || !utf8.Valid(raw) {
		return UpdateAppearanceInput{}, ErrInvalidAppearance
	}
	var request struct {
		AccentPreset      *string `json:"accentPreset"`
		ExpectedUpdatedAt *string `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.AccentPreset == nil || request.ExpectedUpdatedAt == nil {
		return UpdateAppearanceInput{}, ErrInvalidAppearance
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return UpdateAppearanceInput{}, ErrInvalidAppearance
	}
	return UpdateAppearanceInput{AccentPreset: *request.AccentPreset, ExpectedUpdatedAt: *request.ExpectedUpdatedAt}, nil
}

// writeError intentionally logs no request body, preset values or raw database
// error detail; all infrastructure responses use the existing sanitized shape.
func (h *AppearanceHandler) writeError(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrSettingsPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrInvalidAppearance):
		businessError(w, CodeInvalidAppearance, "Invalid site appearance")
	case errors.Is(err, ErrAppearanceConflict):
		businessError(w, CodeAppearanceConflict, "Appearance conflict")
	default:
		h.logger.ErrorContext(r.Context(), "appearance_request_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "operation", op)
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
