package shortlink

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

// BatchTransferPort isolates atomic ownership handoffs from other batch management actions.
type BatchTransferPort interface {
	BatchTransfer(context.Context, auth.CurrentUser, BatchTransferInput) (BatchTransferResult, error)
}

// BatchTransferHandler enforces one strict JSON request and redacts infrastructure failures.
type BatchTransferHandler struct {
	service BatchTransferPort
	logger  *slog.Logger
}

// NewBatchTransferHandler constructs the batch endpoint with the application logger.
func NewBatchTransferHandler(service BatchTransferPort, logger *slog.Logger) *BatchTransferHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchTransferHandler{service: service, logger: logger}
}

// BatchTransfer accepts only complete bounded versions and an exact recipient username.
func (h *BatchTransferHandler) BatchTransfer(w http.ResponseWriter, r *http.Request) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input BatchTransferInput
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBatchTransfer(input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.BatchTransfer(r.Context(), auth.UserFromContext(r.Context()), input)
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_transfer_failed")
}
