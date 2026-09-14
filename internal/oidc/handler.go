package oidc

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/go-chi/chi/v5"
)

const (
	CodeInvalidRequest       = 100001
	CodePermissionDenied     = 120001
	CodeProviderNotFound     = 340101
	CodeProviderConflict     = 340102
	CodeProviderKeyExists    = 340103
	CodeRuntimeUnavailable   = 340104
	CodeDiscoveryUnavailable = 340105
	CodeInternalServerError  = 900000
	maxProviderBodyBytes     = 64 << 10
)

// LoginPort exposes the public OIDC browser flow.
type LoginPort interface {
	Start(context.Context, string, string) (LoginStart, error)
	Callback(context.Context, string, string, string, string) (LoginCallback, error)
}

// Handler serves public OIDC login and administrative provider endpoints.
type Handler struct {
	providers     ProviderPort
	login         LoginPort
	secureCookies bool
	logger        *slog.Logger
}

type handlerResponse struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// NewHandler creates an OIDC HTTP handler with safe defaults.
func NewHandler(providers ProviderPort, login LoginPort, secureCookies bool, logger *slog.Logger) *Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return &Handler{providers: providers, login: login, secureCookies: secureCookies, logger: logger}
}

// Methods returns the enabled secret-free authentication methods.
func (h *Handler) Methods(w http.ResponseWriter, r *http.Request) {
	result, err := h.providers.Methods(r.Context())
	if err != nil {
		h.writeInfrastructure(w, r, "methods", "", err)
		return
	}
	h.writeJSON(w, http.StatusOK, handlerResponse{Code: 0, Message: "OK", Data: result, Meta: map[string]any{}})
}

// Start redirects the browser to one enabled provider's authorization endpoint.
func (h *Handler) Start(w http.ResponseWriter, r *http.Request) {
	h.noStore(w)
	providerKey := chi.URLParam(r, "providerKey")
	result, err := h.login.Start(r.Context(), providerKey, r.URL.Query().Get("returnTo"))
	if err != nil {
		h.logFailure(r, "start", providerKey, err)
		h.redirectLoginError(w, r, "provider_unavailable")
		return
	}
	h.setBrowserBindingCookie(w, providerKey, result)
	http.Redirect(w, r, result.Location, http.StatusFound)
}

// Callback completes one consumed authorization attempt and establishes the local session.
func (h *Handler) Callback(w http.ResponseWriter, r *http.Request) {
	h.noStore(w)
	providerKey := chi.URLParam(r, "providerKey")
	state := r.URL.Query().Get("state")
	bindingCookieName := browserBindingCookieName(state)
	browserBinding := ""
	if cookie, cookieErr := r.Cookie(bindingCookieName); cookieErr == nil {
		browserBinding = cookie.Value
	}
	h.clearBrowserBindingCookie(w, providerKey, bindingCookieName)
	result, err := h.login.Callback(r.Context(), providerKey, r.URL.Query().Get("code"), state, browserBinding)
	if err != nil {
		h.logFailure(r, "callback", providerKey, err)
		errorCode := "login_failed"
		if errors.Is(err, ErrIdentityNotAllowed) {
			errorCode = "identity_not_allowed"
		} else if errors.Is(err, ErrUserDisabled) {
			errorCode = "user_disabled"
		}
		h.redirectLoginError(w, r, errorCode)
		return
	}
	http.SetCookie(w, &http.Cookie{
		Name: auth.SessionCookieName, Value: result.Session.ID, Path: "/", Expires: result.Session.ExpiresAt,
		HttpOnly: true, Secure: h.secureCookies, SameSite: http.SameSiteLaxMode,
	})
	http.Redirect(w, r, result.ReturnPath, http.StatusSeeOther)
}

// setBrowserBindingCookie binds one authorization attempt to the initiating browser.
func (h *Handler) setBrowserBindingCookie(w http.ResponseWriter, providerKey string, result LoginStart) {
	http.SetCookie(w, &http.Cookie{
		Name: result.BindingCookieName, Value: result.BrowserBinding, Path: oidcCallbackPath(providerKey), Expires: result.ExpiresAt,
		HttpOnly: true, Secure: h.secureCookies, SameSite: http.SameSiteLaxMode,
	})
}

// clearBrowserBindingCookie removes the one-time browser proof on every callback outcome.
func (h *Handler) clearBrowserBindingCookie(w http.ResponseWriter, providerKey string, name string) {
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: "", Path: oidcCallbackPath(providerKey), Expires: time.Unix(1, 0), MaxAge: -1,
		HttpOnly: true, Secure: h.secureCookies, SameSite: http.SameSiteLaxMode,
	})
}

// oidcCallbackPath returns the narrow cookie scope for one provider callback.
func oidcCallbackPath(providerKey string) string {
	return "/api/v1/auth/oidc/" + providerKey + "/callback"
}

// List returns active provider configuration to administrators.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	result, err := h.providers.List(r.Context(), auth.UserFromContext(r.Context()))
	h.writeProviderResult(w, r, "list", "", result, err)
}

// Create validates and creates one provider.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateProviderInput
	if !decodeProviderInput(w, r, &input) {
		h.writeJSON(w, http.StatusOK, handlerResponse{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.providers.Create(r.Context(), auth.UserFromContext(r.Context()), input)
	h.writeProviderResult(w, r, "create", input.Key, result, err)
}

// Update validates and updates one provider with optimistic concurrency.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input UpdateProviderInput
	if !decodeProviderInput(w, r, &input) {
		h.writeJSON(w, http.StatusOK, handlerResponse{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.providers.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	h.writeProviderResult(w, r, "update", "", result, err)
}

// Delete soft deletes one provider with optimistic concurrency.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	var input DeleteProviderInput
	if !decodeProviderInput(w, r, &input) {
		h.writeJSON(w, http.StatusOK, handlerResponse{Code: CodeInvalidRequest, Message: "Invalid request", Data: nil, Meta: map[string]any{}})
		return
	}
	result, err := h.providers.Delete(r.Context(), auth.UserFromContext(r.Context()), input)
	h.writeProviderResult(w, r, "delete", "", result, err)
}

// writeProviderResult maps provider service results into the versioned API envelope.
func (h *Handler) writeProviderResult(w http.ResponseWriter, r *http.Request, operation string, providerKey string, data any, err error) {
	if err == nil {
		h.writeJSON(w, http.StatusOK, handlerResponse{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
		return
	}
	code, message := CodeInternalServerError, "Internal server error"
	status := http.StatusInternalServerError
	switch {
	case errors.Is(err, ErrInvalidInput):
		code, message, status = CodeInvalidRequest, "Invalid request", http.StatusOK
	case errors.Is(err, ErrPermissionDenied):
		code, message, status = CodePermissionDenied, "Permission denied", http.StatusOK
	case errors.Is(err, ErrProviderNotFound):
		code, message, status = CodeProviderNotFound, "Provider not found", http.StatusOK
	case errors.Is(err, ErrProviderConflict):
		code, message, status = CodeProviderConflict, "Provider conflict", http.StatusOK
	case errors.Is(err, ErrProviderKeyExists):
		code, message, status = CodeProviderKeyExists, "Provider key already exists", http.StatusOK
	case errors.Is(err, ErrRuntimeUnavailable):
		code, message, status = CodeRuntimeUnavailable, "OIDC runtime unavailable", http.StatusOK
	case errors.Is(err, ErrDiscoveryUnavailable):
		code, message, status = CodeDiscoveryUnavailable, "OIDC discovery unavailable", http.StatusOK
	default:
		h.logFailure(r, operation, providerKey, err)
	}
	h.writeJSON(w, status, handlerResponse{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeInfrastructure logs an opaque failure classification before returning HTTP 500.
func (h *Handler) writeInfrastructure(w http.ResponseWriter, r *http.Request, operation string, providerKey string, err error) {
	h.logFailure(r, operation, providerKey, err)
	h.writeJSON(w, http.StatusInternalServerError, handlerResponse{Code: CodeInternalServerError, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
}

// logFailure records request context without serializing sensitive error contents.
func (h *Handler) logFailure(r *http.Request, operation string, providerKey string, err error) {
	attributes := []any{"request_id", middleware.RequestIDFromContext(r.Context()), "operation", operation, "error_type", fmt.Sprintf("%T", err)}
	if providerKeyPattern.MatchString(providerKey) {
		attributes = append(attributes, "provider_key", providerKey)
	}
	h.logger.ErrorContext(r.Context(), "oidc_request_failed", attributes...)
}

// redirectLoginError returns a fixed local login error location.
func (h *Handler) redirectLoginError(w http.ResponseWriter, r *http.Request, code string) {
	http.Redirect(w, r, "/login?"+url.Values{"oidcError": []string{code}}.Encode(), http.StatusSeeOther)
}

// noStore prevents browser and intermediary caching of authentication responses.
func (h *Handler) noStore(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
}

// writeJSON serializes one complete API response before committing headers.
func (h *Handler) writeJSON(w http.ResponseWriter, status int, body handlerResponse) {
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(body); err != nil {
		status = http.StatusInternalServerError
		buffer.Reset()
		buffer.WriteString(`{"code":900000,"message":"Internal server error","data":null,"meta":{}}` + "\n")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}

// decodeProviderInput accepts one bounded strict JSON object and no trailing values.
func decodeProviderInput(w http.ResponseWriter, r *http.Request, target any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxProviderBodyBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return false
	}
	return errors.Is(decoder.Decode(&struct{}{}), io.EOF)
}
