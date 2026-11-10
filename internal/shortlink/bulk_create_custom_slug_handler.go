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

// BatchCreateWithCustomSlugsPort independently exposes the strictly bounded fourth protocol.
type BatchCreateWithCustomSlugsPort interface {
	BatchCreateWithCustomSlugs(context.Context, auth.CurrentUser, BatchCreateWithCustomSlugsInput) (BatchCreateResult, error)
}

// BulkCreateCustomSlugHandler binds a strict custom-slug batch endpoint to its service.
type BulkCreateCustomSlugHandler struct {
	service BatchCreateWithCustomSlugsPort
	logger  *slog.Logger
}

// NewBulkCreateCustomSlugHandler preserves application logging without retaining raw requests.
func NewBulkCreateCustomSlugHandler(service BatchCreateWithCustomSlugsPort, logger *slog.Logger) *BulkCreateCustomSlugHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateCustomSlugHandler{service: service, logger: logger}
}

// BatchCreateWithCustomSlugs rejects malformed or stale-account writes before calling the service.
func (h *BulkCreateCustomSlugHandler) BatchCreateWithCustomSlugs(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithCustomSlugs(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithCustomSlugs(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithCustomSlugs(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithCustomSlugs rejects missing, duplicate, unknown and trailing fields.
func decodeBulkCreateWithCustomSlugs(body []byte) (BatchCreateWithCustomSlugsInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithCustomSlugsInput{}, false
	}
	var input BatchCreateWithCustomSlugsInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateWithCustomSlugsInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return BatchCreateWithCustomSlugsInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithCustomSlugsInput{}, false
			}
			for d.More() {
				item, ok := decodeBulkCustomSlugItem(d)
				if !ok || len(input.Items) == 20 {
					return BatchCreateWithCustomSlugsInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithCustomSlugsInput{}, false
			}
		default:
			return BatchCreateWithCustomSlugsInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithCustomSlugsInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithCustomSlugsInput{}, false
	}
	return input, true
}

// decodeBulkCustomSlugItem preserves raw strings and requires a non-null bounded string tag array.
func decodeBulkCustomSlugItem(d *json.Decoder) (BatchCreateCustomSlugItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateCustomSlugItem{}, false
	}
	var item BatchCreateCustomSlugItem
	seen := make(map[string]bool, 4)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateCustomSlugItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return BatchCreateCustomSlugItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateCustomSlugItem{}, false
			}
			item.Tags = []string{}
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return BatchCreateCustomSlugItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateCustomSlugItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return BatchCreateCustomSlugItem{}, false
		}
		switch key {
		case "targetUrl":
			item.TargetURL = value
		case "title":
			item.Title = value
		case "customSlug":
			item.CustomSlug = value
		default:
			return BatchCreateCustomSlugItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 4
}
