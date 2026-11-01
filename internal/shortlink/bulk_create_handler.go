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

// BatchCreatePort exposes atomic batch creation without extending legacy single-link DTOs.
type BatchCreatePort interface {
	BatchCreate(context.Context, auth.CurrentUser, BatchCreateInput) (BatchCreateResult, error)
}

// BulkCreateHandler accepts one bounded unambiguous personal creation request.
type BulkCreateHandler struct {
	service BatchCreatePort
	logger  *slog.Logger
}

// NewBulkCreateHandler binds the atomic service to the application's structured logger.
func NewBulkCreateHandler(service BatchCreatePort, logger *slog.Logger) *BulkCreateHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateHandler{service: service, logger: logger}
}

// BatchCreate rejects malformed framing before invoking any business write.
func (h *BulkCreateHandler) BatchCreate(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	const limit = 64 * 1024
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || len(body) > limit || !utf8.Valid(body) {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, valid := decodeBulkCreate(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreate(input); err != nil {
		h.writeResult(w, r, BatchCreateResult{}, err)
		return
	}
	result, err := h.service.BatchCreate(r.Context(), auth.UserFromContext(r.Context()), input)
	h.writeResult(w, r, result, err)
}

// writeResult keeps batch-only failures distinct while reusing opaque infrastructure diagnostics.
func (h *BulkCreateHandler) writeResult(w http.ResponseWriter, r *http.Request, result BatchCreateResult, err error) {
	switch {
	case errors.Is(err, ErrBulkCreateConflict):
		businessError(w, 200120, "Batch request has different content")
	case errors.Is(err, ErrInvalidTargetURL):
		businessError(w, CodeInvalidTargetURL, "Invalid target URL")
	case errors.Is(err, ErrDomainUnavailable):
		businessError(w, CodeDomainUnavailable, "Domain unavailable")
	case errors.Is(err, ErrSlugConflict):
		businessError(w, CodeSlugConflict, "Slug conflict")
	default:
		writeTransferResult(w, r, result, err, h.logger, "short_link_bulk_create_failed")
	}
}

// decodeBulkCreate rejects duplicate keys, unknown fields, null arrays and trailing JSON values.
func decodeBulkCreate(body []byte) (BatchCreateInput, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateInput{}, false
	}
	var input BatchCreateInput
	seen := make(map[string]bool, 2)
	for decoder.More() {
		token, err := decoder.Token()
		key, isString := token.(string)
		if err != nil || !isString || seen[key] {
			return BatchCreateInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			err = decoder.Decode(&input.RequestID)
		case "targetUrls":
			err = decoder.Decode(&input.TargetURLs)
		default:
			return BatchCreateInput{}, false
		}
		if err != nil {
			return BatchCreateInput{}, false
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 || input.TargetURLs == nil {
		return BatchCreateInput{}, false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateInput{}, false
	}
	return input, true
}
