package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

// PasswordPort is deliberately separate from the existing authentication transport contract.
type PasswordPort interface {
	PasswordStatus(context.Context, string) (PasswordStatus, error)
	ChangePassword(context.Context, string, ChangePasswordInput) error
}

// PasswordHandler serves session-authenticated local credential management.
type PasswordHandler struct {
	service       PasswordPort
	secureCookies bool
	logger        *slog.Logger
}

// NewPasswordHandler creates a password handler with sanitized infrastructure logging.
func NewPasswordHandler(service PasswordPort, secureCookies bool, logger *slog.Logger) *PasswordHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &PasswordHandler{service: service, secureCookies: secureCookies, logger: logger}
}

// Status returns the local password capability for a valid live session.
func (h *PasswordHandler) Status(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		h.writeError(w, r, ErrInvalidSession)
		return
	}
	status, err := h.service.PasswordStatus(r.Context(), cookie.Value)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	ok(w, status)
}

// Change accepts one strict JSON object and clears the cookie only after the transaction succeeds.
func (h *PasswordHandler) Change(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	cookie, err := r.Cookie(SessionCookieName)
	if err != nil || cookie.Value == "" {
		h.writeError(w, r, ErrInvalidSession)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		h.writeError(w, r, ErrInvalidPasswordInput)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, middleware.MaxJSONBodyBytes+1))
	if err != nil || len(body) > middleware.MaxJSONBodyBytes || !validPasswordJSONUnicode(body) {
		h.writeError(w, r, ErrInvalidPasswordInput)
		return
	}
	var input ChangePasswordInput
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		h.writeError(w, r, ErrInvalidPasswordInput)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		h.writeError(w, r, ErrInvalidPasswordInput)
		return
	}
	if err := h.service.ChangePassword(r.Context(), cookie.Value, input); err != nil {
		h.writeError(w, r, err)
		return
	}
	http.SetCookie(w, clearSessionCookie(h.secureCookies))
	ok(w, map[string]bool{"changed": true})
}

// validPasswordJSONUnicode rejects bytes and surrogate escapes that encoding/json would silently replace.
func validPasswordJSONUnicode(body []byte) bool {
	if !utf8.Valid(body) {
		return false
	}
	for i := 0; i < len(body); i++ {
		if body[i] != '\\' {
			continue
		}
		i++
		if i >= len(body) {
			return false
		}
		if body[i] != 'u' {
			continue
		}
		if i+4 >= len(body) {
			return false
		}
		value, err := strconv.ParseUint(string(body[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if value >= 0xdc00 && value <= 0xdfff {
			return false
		}
		if value >= 0xd800 && value <= 0xdbff {
			if i+6 >= len(body) || body[i+1] != '\\' || body[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(body[i+3:i+7]), 16, 16)
			if err != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}

// writeError maps credential failures without recording raw database errors or request secrets.
func (h *PasswordHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidSession):
		writeJSON(w, http.StatusUnauthorized, response{Code: CodeInvalidCredentials, Message: "Invalid session", Data: nil, Meta: map[string]any{}})
	case errors.Is(err, ErrInvalidPasswordInput):
		businessError(w, CodeInvalidRequest, "Invalid request")
	case errors.Is(err, ErrInvalidCredentials):
		businessError(w, CodeInvalidCredentials, "Invalid current password")
	case errors.Is(err, ErrLoginRateLimited):
		businessError(w, CodeLoginRateLimited, "Password change temporarily unavailable")
	case errors.Is(err, ErrPasswordUnavailable):
		businessError(w, 110105, "Local password unavailable")
	default:
		h.logger.ErrorContext(r.Context(), "password_request_failed", "request_id", middleware.RequestIDFromContext(r.Context()), "category", "infrastructure")
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
}
