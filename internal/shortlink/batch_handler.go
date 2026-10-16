package shortlink

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// BatchPort exposes atomic batch management independently of existing single-link operations.
type BatchPort interface {
	Batch(context.Context, auth.CurrentUser, BatchInput) (BatchResult, error)
	AdminBatch(context.Context, auth.CurrentUser, BatchInput) (BatchResult, error)
}

// BatchHandler serves strictly decoded batch requests in personal and administrative scopes.
type BatchHandler struct {
	service BatchPort
	logger  *slog.Logger
}

// NewBatchHandler constructs a batch handler using the shared application logger.
func NewBatchHandler(service BatchPort, logger *slog.Logger) *BatchHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchHandler{service: service, logger: logger}
}

// Batch manages a batch of links owned by the current user.
func (h *BatchHandler) Batch(w http.ResponseWriter, r *http.Request) {
	h.batch(w, r, h.service.Batch)
}

// AdminBatch manages a batch of links through the administrative permission boundary.
func (h *BatchHandler) AdminBatch(w http.ResponseWriter, r *http.Request) {
	h.batch(w, r, h.service.AdminBatch)
}

// batch rejects malformed JSON and invalid inputs before calling the selected service operation.
func (h *BatchHandler) batch(w http.ResponseWriter, r *http.Request, run func(context.Context, auth.CurrentUser, BatchInput) (BatchResult, error)) {
	var request struct {
		IDs    []*string `json:"ids"`
		Action *string   `json:"action"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		businessError(w, 100001, "Invalid request")
		return
	}
	if request.Action == nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	input := BatchInput{IDs: make([]string, len(request.IDs)), Action: *request.Action}
	for index, id := range request.IDs {
		if id == nil {
			businessError(w, 100001, "Invalid request")
			return
		}
		input.IDs[index] = *id
	}
	if _, err := normalizeBatch(input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := run(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, r, h.logger, err)
		return
	}
	ok(w, result)
}
