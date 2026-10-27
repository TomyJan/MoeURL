package domain

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// OrderPort adds a separate action without widening the legacy domain management port.
type OrderPort interface {
	SetOrder(context.Context, auth.CurrentUser, SetOrderInput) (Domain, error)
}

// OrderHandler validates a complete order command and reuses domain error responses.
type OrderHandler struct {
	service   OrderPort
	responses *Handler
}

// NewOrderHandler wires priority writes to the domain's sanitized response boundary.
func NewOrderHandler(service OrderPort, logger *slog.Logger) *OrderHandler {
	return &OrderHandler{service: service, responses: NewHandler(nil, logger)}
}

// SetOrder accepts exactly one fully specified JSON ordering command.
func (h *OrderHandler) SetOrder(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input struct {
		ID                *string `json:"id"`
		SortOrder         *int32  `json:"sortOrder"`
		ExpectedUpdatedAt *string `json:"expectedUpdatedAt"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || input.ID == nil || input.SortOrder == nil || input.ExpectedUpdatedAt == nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.SetOrder(r.Context(), auth.UserFromContext(r.Context()), SetOrderInput{ID: *input.ID, SortOrder: *input.SortOrder, ExpectedUpdatedAt: *input.ExpectedUpdatedAt})
	if err != nil {
		h.responses.writeError(w, r, err)
		return
	}
	ok(w, map[string]Domain{"domain": result})
}
