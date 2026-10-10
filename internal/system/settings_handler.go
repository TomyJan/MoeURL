package system

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

const (
	CodeInvalidSettings  = 900201
	CodeSettingsConflict = 900202
	CodeNoLoginProvider  = 900203
)

// SettingsPort exposes public and administrative settings operations.
type SettingsPort interface {
	PublicConfig(context.Context) (PublicConfig, error)
	GetSettings(context.Context, auth.CurrentUser) (Settings, error)
	UpdateSettings(context.Context, auth.CurrentUser, UpdateSettingsInput) (Settings, error)
}

// SettingsHandler serves the public configuration and administrative settings endpoints.
type SettingsHandler struct {
	service SettingsPort
	logger  *slog.Logger
}

type updateSettingsRequest struct {
	SiteName          *string `json:"siteName"`
	DefaultLanguage   *string `json:"defaultLanguage"`
	DefaultTheme      *string `json:"defaultTheme"`
	FooterText        *string `json:"footerText"`
	ShowPoweredBy     *bool   `json:"showPoweredBy"`
	LocalLoginEnabled *bool   `json:"localLoginEnabled"`
	ExpectedUpdatedAt *string `json:"expectedUpdatedAt"`
}

// NewSettingsHandler creates a settings HTTP handler.
func NewSettingsHandler(service SettingsPort, logger *slog.Logger) *SettingsHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &SettingsHandler{service: service, logger: logger}
}

// PublicConfig returns the non-sensitive site configuration.
func (h *SettingsHandler) PublicConfig(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.PublicConfig(r.Context())
	if err != nil {
		h.writeError(w, r, "public_config", err)
		return
	}
	ok(w, result)
}

// Get returns the complete settings document to authorized administrators.
func (h *SettingsHandler) Get(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.GetSettings(r.Context(), auth.UserFromContext(r.Context()))
	if err != nil {
		h.writeError(w, r, "get", err)
		return
	}
	ok(w, result)
}

// Update strictly decodes and applies one complete optimistic settings update.
func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var request updateSettingsRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		businessError(w, CodeInvalidSettings, "Invalid settings")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		businessError(w, CodeInvalidSettings, "Invalid settings")
		return
	}
	input, complete := request.input()
	if !complete {
		businessError(w, CodeInvalidSettings, "Invalid settings")
		return
	}
	result, err := h.service.UpdateSettings(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		h.writeError(w, r, "update", err)
		return
	}
	ok(w, result)
}

// input converts a complete wire request into the domain update model.
func (r updateSettingsRequest) input() (UpdateSettingsInput, bool) {
	if r.SiteName == nil || r.DefaultLanguage == nil || r.DefaultTheme == nil || r.FooterText == nil ||
		r.ShowPoweredBy == nil || r.LocalLoginEnabled == nil || r.ExpectedUpdatedAt == nil {
		return UpdateSettingsInput{}, false
	}
	return UpdateSettingsInput{
		SiteName: *r.SiteName, DefaultLanguage: *r.DefaultLanguage, DefaultTheme: *r.DefaultTheme,
		FooterText: *r.FooterText, ShowPoweredBy: *r.ShowPoweredBy,
		LocalLoginEnabled: *r.LocalLoginEnabled, ExpectedUpdatedAt: *r.ExpectedUpdatedAt,
	}, true
}

func (h *SettingsHandler) writeError(w http.ResponseWriter, r *http.Request, operation string, err error) {
	switch {
	case errors.Is(err, ErrSettingsPermissionDenied):
		businessError(w, 120001, "Permission denied")
	case errors.Is(err, ErrInvalidSettings):
		businessError(w, CodeInvalidSettings, "Invalid settings")
	case errors.Is(err, ErrSettingsConflict):
		businessError(w, CodeSettingsConflict, "Settings conflict")
	case errors.Is(err, ErrNoLoginProvider):
		businessError(w, CodeNoLoginProvider, "No available OIDC provider")
	default:
		h.logger.ErrorContext(r.Context(), "system_settings_request_failed",
			"request_id", middleware.RequestIDFromContext(r.Context()), "operation", operation, "error", err)
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
