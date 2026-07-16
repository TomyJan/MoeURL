package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const (
	CodePermissionDenied = 120001
	CodeUsernameExists   = 300101
	CodeBuiltinImmutable = 300102
	CodeUserNotFound     = 300103
)

type Port interface {
	Create(ctx context.Context, actor auth.CurrentUser, input CreateInput) (CreateResult, error)
	List(ctx context.Context, actor auth.CurrentUser, input ListInput) (ListResult, error)
	Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (UpdateResult, error)
	ResetPassword(ctx context.Context, actor auth.CurrentUser, input ResetPasswordInput) error
}

type Handler struct {
	service Port
}

// NewHandler implements package-specific behavior.
func NewHandler(service Port) *Handler {
	return &Handler{service: service}
}

// Create implements package-specific behavior.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	var input CreateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Create(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		switch {
		case errors.Is(err, ErrPermissionDenied):
			businessError(w, CodePermissionDenied, "Permission denied")
		case errors.Is(err, ErrUsernameExists):
			businessError(w, CodeUsernameExists, "Username exists")
		case errors.Is(err, ErrInvalidInput):
			businessError(w, 100001, "Invalid request")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	ok(w, result)
}

// List implements package-specific behavior.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	result, err := h.service.List(r.Context(), auth.UserFromContext(r.Context()), ListInput{
		Page:     queryInt32WithDefault(r, "page", defaultPage),
		PageSize: queryInt32WithDefault(r, "pageSize", defaultPageSize),
	})
	if err != nil {
		writeUserError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, response{
		Code:    0,
		Message: "OK",
		Data:    map[string]any{"items": result.Items},
		Meta: map[string]any{
			"page":     result.Page,
			"pageSize": result.PageSize,
			"total":    result.Total,
		},
	})
}

// Update implements package-specific behavior.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	var input UpdateInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Update(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeUserError(w, err)
		return
	}
	ok(w, result)
}

// ResetPassword implements package-specific behavior.
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	var input ResetPasswordInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	err := h.service.ResetPassword(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeUserError(w, err)
		return
	}
	ok(w, map[string]bool{"reset": true})
}

// writeUserError implements package-specific behavior.
func writeUserError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrPermissionDenied):
		businessError(w, CodePermissionDenied, "Permission denied")
	case errors.Is(err, ErrUsernameExists):
		businessError(w, CodeUsernameExists, "Username exists")
	case errors.Is(err, ErrInvalidInput):
		businessError(w, 100001, "Invalid request")
	case errors.Is(err, ErrBuiltinUserImmutable):
		businessError(w, CodeBuiltinImmutable, "Builtin user cannot be modified")
	case errors.Is(err, ErrUserNotFound):
		businessError(w, CodeUserNotFound, "User not found")
	default:
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
	}
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
	var buffer bytes.Buffer
	if err := json.NewEncoder(&buffer).Encode(body); err != nil {
		slog.Error("encoding user response", "error", err)
		http.Error(w, "Internal server error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_, _ = w.Write(buffer.Bytes())
}

// queryInt32WithDefault implements package-specific behavior.
func queryInt32WithDefault(r *http.Request, key string, defaultValue int32) int32 {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return defaultValue
	}
	parsed, err := strconv.ParseInt(raw, 10, 32)
	if err != nil {
		return defaultValue
	}
	return int32(parsed)
}
