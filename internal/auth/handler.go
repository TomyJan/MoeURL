package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"
)

const (
	CodeInvalidRequest     = 100001
	CodeInvalidCredentials = 110101
	CodeUserDisabled       = 110102
)

type Port interface {
	Login(ctx context.Context, input LoginInput) (LoginResult, error)
	Logout(ctx context.Context, sessionID string) error
	Me(ctx context.Context, sessionID string) (CurrentUser, error)
}

type Handler struct {
	service Port
}

// NewHandler implements package-specific behavior.
func NewHandler(service Port) *Handler {
	return &Handler{service: service}
}

// Login implements package-specific behavior.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	var input LoginInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, CodeInvalidRequest, "Invalid request")
		return
	}

	result, err := h.service.Login(r.Context(), input)
	if err != nil {
		switch {
		case errors.Is(err, ErrInvalidCredentials):
			businessError(w, CodeInvalidCredentials, "Invalid username or password")
		case errors.Is(err, ErrUserDisabled):
			businessError(w, CodeUserDisabled, "User disabled")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	http.SetCookie(w, sessionCookie(result.Session.ID, result.Session.ExpiresAt))
	ok(w, map[string]any{"user": result.User})
}

// Logout implements package-specific behavior.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		_ = h.service.Logout(r.Context(), cookie.Value)
	}

	http.SetCookie(w, clearSessionCookie())
	ok(w, map[string]bool{"loggedOut": true})
}

// Me implements package-specific behavior.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	sessionID := ""
	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		sessionID = cookie.Value
	}

	user, err := h.service.Me(r.Context(), sessionID)
	if err != nil {
		user = GuestUser()
	}

	ok(w, map[string]any{"user": user})
}

// sessionCookie implements package-specific behavior.
func sessionCookie(value string, expiresAt time.Time) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   isProduction(),
		SameSite: http.SameSiteLaxMode,
	}
}

// clearSessionCookie implements package-specific behavior.
func clearSessionCookie() *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   isProduction(),
		SameSite: http.SameSiteLaxMode,
	}
}

// isProduction implements package-specific behavior.
func isProduction() bool {
	return os.Getenv("MOEURL_ENV") == "production"
}

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// ok implements package-specific behavior.
func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

// businessError implements package-specific behavior.
func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeJSON implements package-specific behavior.
func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
