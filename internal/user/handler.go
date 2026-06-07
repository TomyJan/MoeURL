package user

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

const (
	CodePermissionDenied = 120001
	CodeUsernameExists   = 300101
)

type Port interface {
	Create(ctx context.Context, actor auth.CurrentUser, input CreateInput) (CreateResult, error)
}

type Handler struct {
	service Port
}

func NewHandler(service Port) *Handler {
	return &Handler{service: service}
}

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

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

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
