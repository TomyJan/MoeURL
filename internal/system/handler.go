package system

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

const (
	CodeAlreadyInitialized = 900101
)

type Handler struct {
	service ServicePort
}

type ServicePort interface {
	IsInitialized(ctx context.Context) (bool, error)
	Setup(ctx context.Context, input SetupInput) error
}

// NewHandler creates an HTTP handler backed by the system service.
func NewHandler(service ServicePort) *Handler {
	return &Handler{service: service}
}

// Status returns whether initial system setup has completed.
func (h *Handler) Status(w http.ResponseWriter, r *http.Request) {
	initialized, err := h.service.IsInitialized(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		return
	}

	ok(w, map[string]bool{"initialized": initialized})
}

// Setup validates and submits the initial system configuration.
func (h *Handler) Setup(w http.ResponseWriter, r *http.Request) {
	var input SetupInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}

	if err := h.service.Setup(r.Context(), input); err != nil {
		switch {
		case errors.Is(err, ErrAlreadyInitialized):
			businessError(w, CodeAlreadyInitialized, "System already initialized")
		case errors.Is(err, ErrInvalidSetupInput):
			businessError(w, 100001, "Invalid request")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	ok(w, map[string]bool{"initialized": true})
}

type response struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data"`
	Meta    any    `json:"meta"`
}

// ok writes a successful system response.
func ok(w http.ResponseWriter, data any) {
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: data, Meta: map[string]any{}})
}

// businessError writes a system business failure response.
func businessError(w http.ResponseWriter, code int, message string) {
	writeJSON(w, http.StatusOK, response{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}

// writeJSON writes a system response as JSON.
func writeJSON(w http.ResponseWriter, status int, body response) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
