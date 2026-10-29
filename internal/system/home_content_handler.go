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
	CodeInvalidHomeContent  = 900204
	CodeHomeContentConflict = 900205
)

// HomeContentPort keeps public copy and independent management revisions separate.
type HomeContentPort interface {
	PublicHomeContent(context.Context) (HomeContent, error)
	GetHomeContent(context.Context, auth.CurrentUser) (HomeContentSettings, error)
	UpdateHomeContent(context.Context, auth.CurrentUser, UpdateHomeContentInput) (HomeContentSettings, error)
}

// HomeContentHandler implements only the three independent content endpoints.
type HomeContentHandler struct {
	service HomeContentPort
	logger  *slog.Logger
}

// NewHomeContentHandler uses the application's request logger when provided.
func NewHomeContentHandler(service HomeContentPort, logger *slog.Logger) *HomeContentHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &HomeContentHandler{service: service, logger: logger}
}

// Public returns only unlocalized public overrides, without a management token.
func (h *HomeContentHandler) Public(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.PublicHomeContent(r.Context())
	if err != nil {
		h.writeError(w, r, "public", err)
		return
	}
	ok(w, content)
}

// Get returns a current-authorized management projection.
func (h *HomeContentHandler) Get(w http.ResponseWriter, r *http.Request) {
	content, err := h.service.GetHomeContent(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, "get", err)
		return
	}
	ok(w, content)
}

// Update requires a complete bounded UTF8 JSON document before business writes.
func (h *HomeContentHandler) Update(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		h.writeError(w, r, "update", ErrInvalidHomeContent)
		return
	}
	input, err := decodeHomeContent(r.Body)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	content, err := h.service.UpdateHomeContent(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	ok(w, content)
}

// decodeHomeContent preserves the full version string and rejects malformed
// requests without passing a partial command through to persistence.
func decodeHomeContent(body io.Reader) (UpdateHomeContentInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 8193))
	if err != nil || len(raw) > 8192 || !utf8.Valid(raw) {
		return UpdateHomeContentInput{}, ErrInvalidHomeContent
	}
	var request struct {
		Title             *string `json:"title"`
		Summary           *string `json:"summary"`
		ExpectedUpdatedAt *string `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || request.Title == nil || request.Summary == nil || request.ExpectedUpdatedAt == nil {
		return UpdateHomeContentInput{}, ErrInvalidHomeContent
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return UpdateHomeContentInput{}, ErrInvalidHomeContent
	}
	return UpdateHomeContentInput{Title: *request.Title, Summary: *request.Summary, ExpectedUpdatedAt: *request.ExpectedUpdatedAt}, nil
}

// writeError intentionally logs no request body, copy values or raw database
// error detail; all infrastructure responses use the existing sanitized shape.
func (h *HomeContentHandler) writeError(w http.ResponseWriter, r *http.Request, op string, err error) {
	switch {
	case errors.Is(err, ErrSettingsPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrInvalidHomeContent):
		businessError(w, CodeInvalidHomeContent, "Invalid homepage copy")
	case errors.Is(err, ErrHomeContentConflict):
		businessError(w, CodeHomeContentConflict, "Homepage copy conflict")
	default:
		h.logger.ErrorContext(r.Context(), "home_content_request_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "operation", op)
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
