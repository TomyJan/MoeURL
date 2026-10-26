package shortlink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// BatchTagsPort separates atomic tag organization from existing single-link updates.
type BatchTagsPort interface {
	BatchTags(context.Context, auth.CurrentUser, BatchTagsInput) (BatchTagsResult, error)
	AdminBatchTags(context.Context, auth.CurrentUser, BatchTagsInput) (BatchTagsResult, error)
}

// BatchTagsHandler strictly decodes tag requests and redacts infrastructure diagnostics.
type BatchTagsHandler struct {
	service BatchTagsPort
	logger  *slog.Logger
}

// NewBatchTagsHandler binds both endpoints to the application's structured logger.
func NewBatchTagsHandler(service BatchTagsPort, logger *slog.Logger) *BatchTagsHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchTagsHandler{service: service, logger: logger}
}

// BatchTags dispatches an atomic personal tag operation.
func (h *BatchTagsHandler) BatchTags(w http.ResponseWriter, r *http.Request) { h.handle(w, r, false) }

// AdminBatchTags dispatches an atomic tag operation across link owners.
func (h *BatchTagsHandler) AdminBatchTags(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true)
}

// handle rejects malformed framing and invalid Unicode before invoking the service.
func (h *BatchTagsHandler) handle(w http.ResponseWriter, r *http.Request, admin bool) {
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	body, err := io.ReadAll(r.Body)
	if err != nil || !utf8.Valid(body) {
		businessError(w, 100001, "Invalid request")
		return
	}
	var input BatchTagsInput
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, _, err := normalizeBatchTags(input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	var result BatchTagsResult
	if admin {
		result, err = h.service.AdminBatchTags(r.Context(), auth.UserFromContext(r.Context()), input)
	} else {
		result, err = h.service.BatchTags(r.Context(), auth.UserFromContext(r.Context()), input)
	}
	if errors.Is(err, ErrBatchTagsLimit) {
		businessError(w, 200119, "Resulting tag count exceeds limit")
		return
	}
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_tags_failed")
}
