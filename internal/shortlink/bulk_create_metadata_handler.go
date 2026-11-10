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

// BatchCreateWithMetadataPort leaves the original two protocols unchanged and independently optional.
type BatchCreateWithMetadataPort interface {
	BatchCreateWithMetadata(context.Context, auth.CurrentUser, BatchCreateWithMetadataInput) (BatchCreateResult, error)
}

// BulkCreateMetadataHandler strictly decodes bounded raw titles and tag arrays.
type BulkCreateMetadataHandler struct {
	service BatchCreateWithMetadataPort
	logger  *slog.Logger
}

// NewBulkCreateMetadataHandler binds the optional metadata endpoint to the application logger.
func NewBulkCreateMetadataHandler(service BatchCreateWithMetadataPort, logger *slog.Logger) *BulkCreateMetadataHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateMetadataHandler{service: service, logger: logger}
}

// BatchCreateWithMetadata rejects malformed input and stale account intent before invoking a write.
func (h *BulkCreateMetadataHandler) BatchCreateWithMetadata(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	const limit = 64 * 1024
	body, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil || len(body) > limit || !utf8.Valid(body) || !validBulkTitleUnicodeEscapes(body) {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, valid := decodeBulkCreateWithMetadata(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithMetadata(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithMetadata(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithMetadata enforces exact, duplicate-free fields at every object boundary.
func decodeBulkCreateWithMetadata(body []byte) (BatchCreateWithMetadataInput, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithMetadataInput{}, false
	}
	var input BatchCreateWithMetadataInput
	seen := make(map[string]bool, 2)
	for decoder.More() {
		token, err := decoder.Token()
		key, valid := token.(string)
		if err != nil || !valid || seen[key] {
			return BatchCreateWithMetadataInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			value, err := decoder.Token()
			input.RequestID, valid = value.(string)
			if err != nil || !valid {
				return BatchCreateWithMetadataInput{}, false
			}
		case "items":
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithMetadataInput{}, false
			}
			for decoder.More() {
				item, valid := decodeBulkMetadataItem(decoder)
				if !valid || len(input.Items) == 20 {
					return BatchCreateWithMetadataInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := decoder.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithMetadataInput{}, false
			}
		default:
			return BatchCreateWithMetadataInput{}, false
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithMetadataInput{}, false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithMetadataInput{}, false
	}
	return input, true
}

// decodeBulkMetadataItem preserves raw strings and requires an explicit bounded non-null tag array.
func decodeBulkMetadataItem(decoder *json.Decoder) (BatchCreateMetadataItem, bool) {
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateMetadataItem{}, false
	}
	var item BatchCreateMetadataItem
	seen := make(map[string]bool, 3)
	for decoder.More() {
		token, err := decoder.Token()
		key, valid := token.(string)
		if err != nil || !valid || seen[key] {
			return BatchCreateMetadataItem{}, false
		}
		seen[key] = true
		token, err = decoder.Token()
		if err != nil {
			return BatchCreateMetadataItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateMetadataItem{}, false
			}
			item.Tags = []string{}
			for decoder.More() {
				token, err := decoder.Token()
				tag, valid := token.(string)
				if err != nil || !valid || len(item.Tags) == 10 {
					return BatchCreateMetadataItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := decoder.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateMetadataItem{}, false
			}
			continue
		}
		value, valid := token.(string)
		if !valid {
			return BatchCreateMetadataItem{}, false
		}
		switch key {
		case "targetUrl":
			item.TargetURL = value
		case "title":
			item.Title = value
		default:
			return BatchCreateMetadataItem{}, false
		}
	}
	closing, err := decoder.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 3
}
