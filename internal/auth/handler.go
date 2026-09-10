package auth

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

const (
	// CodeInvalidRequest identifies malformed authentication input.
	CodeInvalidRequest = 100001
	// CodeInvalidCredentials identifies a neutral credential failure.
	CodeInvalidCredentials = 110101
	// CodeUserDisabled identifies a correctly authenticated disabled account.
	CodeUserDisabled = 110102
	// CodeLoginRateLimited identifies a temporary account-level login block.
	CodeLoginRateLimited = 110103
)

type Port interface {
	Login(ctx context.Context, input LoginInput) (LoginResult, error)
	Logout(ctx context.Context, sessionID string) error
	Me(ctx context.Context, sessionID string) (CurrentUser, error)
}

type Handler struct {
	service       Port
	secureCookies bool
	logger        *slog.Logger
}

// NewHandler creates an HTTP handler backed by the authentication service.
func NewHandler(service Port, secureCookies bool) *Handler {
	return NewHandlerWithLogger(service, secureCookies, nil)
}

// NewHandlerWithLogger creates an authentication handler using the shared application logger.
func NewHandlerWithLogger(service Port, secureCookies bool, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{service: service, secureCookies: secureCookies, logger: logger}
}

// Login authenticates credentials and sets the resulting session cookie.
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
		case errors.Is(err, ErrLoginRateLimited):
			businessError(w, CodeLoginRateLimited, "Login temporarily unavailable")
		default:
			h.writeInfrastructureError(w, r, "login", err)
		}
		return
	}

	http.SetCookie(w, sessionCookie(result.Session.ID, result.Session.ExpiresAt, h.secureCookies))
	ok(w, map[string]any{"user": result.User})
}

// Logout revokes the current session when present and clears its cookie.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		if err := h.service.Logout(r.Context(), cookie.Value); err != nil {
			h.writeInfrastructureError(w, r, "logout", err)
			return
		}
	}

	http.SetCookie(w, clearSessionCookie(h.secureCookies))
	ok(w, map[string]bool{"loggedOut": true})
}

// Me returns the current user, falling back to the guest identity.
func (h *Handler) Me(w http.ResponseWriter, r *http.Request) {
	sessionID := ""
	if cookie, err := r.Cookie(SessionCookieName); err == nil {
		sessionID = cookie.Value
	}

	user, err := h.service.Me(r.Context(), sessionID)
	if err != nil {
		if !isExpectedIdentityError(err) {
			h.writeInfrastructureError(w, r, "me", err)
			return
		}
		user = GuestUser()
	}

	ok(w, map[string]any{"user": user})
}

// writeInfrastructureError records one unknown authentication failure and returns a sanitized response.
func (h *Handler) writeInfrastructureError(w http.ResponseWriter, r *http.Request, operation string, err error) {
	logAuthInfrastructureError(h.logger, r, operation, err)
	writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
}

// logAuthInfrastructureError records bounded request metadata without authentication input or session identifiers.
func logAuthInfrastructureError(logger *slog.Logger, r *http.Request, operation string, err error) {
	if logger == nil {
		logger = slog.Default()
	}
	logger.ErrorContext(r.Context(), "auth_request_failed",
		"request_id", middleware.RequestIDFromContext(r.Context()),
		"operation", operation,
		"error", err,
	)
}

// sessionCookie builds the secure session cookie for a newly created session.
func sessionCookie(value string, expiresAt time.Time, secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    value,
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}

// clearSessionCookie builds an expired session cookie.
func clearSessionCookie(secure bool) *http.Cookie {
	return &http.Cookie{
		Name:     SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	}
}

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// ok writes a successful authentication response.
func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

// businessError writes an authentication business failure response.
func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeJSON writes an authentication response as JSON.
func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
