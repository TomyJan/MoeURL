package user

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// CodePreferencesConflict asks the client to reload after an optimistic concurrency conflict.
const CodePreferencesConflict = 300104

// PreferencesPort exposes only current-account reads and complete preference replacements.
type PreferencesPort interface {
	Get(context.Context, auth.CurrentUser) (PreferencesResult, error)
	Update(context.Context, auth.CurrentUser, UpdatePreferencesInput) (PreferencesResult, error)
}

// PreferencesHandler validates nullable documents and maps account preference business errors.
type PreferencesHandler struct {
	service PreferencesPort
	logger  *slog.Logger
}

// NewPreferencesHandler creates the account-scoped preferences HTTP boundary.
func NewPreferencesHandler(service PreferencesPort, logger *slog.Logger) *PreferencesHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &PreferencesHandler{service: service, logger: logger}
}

// Get returns preferences for the resolved current user.
func (h *PreferencesHandler) Get(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.Get(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, result)
}

// Update accepts one complete document and preserves explicit nullable values.
func (h *PreferencesHandler) Update(w http.ResponseWriter, r *http.Request) {
	var document struct {
		Language          json.RawMessage `json:"language"`
		Theme             json.RawMessage `json:"theme"`
		ExpectedUpdatedAt json.RawMessage `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&document); err != nil {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	if len(document.Language) == 0 || len(document.Theme) == 0 || len(document.ExpectedUpdatedAt) == 0 {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	var input UpdatePreferencesInput
	if err := json.Unmarshal(document.Language, &input.Language); err != nil {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	if err := json.Unmarshal(document.Theme, &input.Theme); err != nil {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	if err := json.Unmarshal(document.ExpectedUpdatedAt, &input.ExpectedUpdatedAt); err != nil {
		h.writeError(w, r, ErrInvalidInput)
		return
	}
	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, result)
}

// writeError translates conflicts without exposing database details to clients.
func (h *PreferencesHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrPreferencesConflict):
		businessError(w, CodePreferencesConflict, "Preferences changed")
	default:
		writeUserError(w, r, h.logger, err)
	}
}
