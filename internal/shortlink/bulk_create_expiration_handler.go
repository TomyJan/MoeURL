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

// BatchCreateWithExpirationsPort independently exposes the strictly bounded sixth protocol.
type BatchCreateWithExpirationsPort interface {
	BatchCreateWithExpirations(context.Context, auth.CurrentUser, BatchCreateWithExpirationsInput) (BatchCreateResult, error)
}

// BulkCreateExpirationHandler binds a strict expiration batch endpoint to its service.
type BulkCreateExpirationHandler struct {
	service BatchCreateWithExpirationsPort
	logger  *slog.Logger
}

// NewBulkCreateExpirationHandler preserves application logging without retaining raw requests.
func NewBulkCreateExpirationHandler(service BatchCreateWithExpirationsPort, logger *slog.Logger) *BulkCreateExpirationHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateExpirationHandler{service: service, logger: logger}
}

// BatchCreateWithExpirations rejects malformed or stale-account writes before calling the service.
func (h *BulkCreateExpirationHandler) BatchCreateWithExpirations(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithExpirations(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithExpirations(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithExpirations(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithExpirations rejects missing, duplicate, unknown and trailing fields.
func decodeBulkCreateWithExpirations(body []byte) (BatchCreateWithExpirationsInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithExpirationsInput{}, false
	}
	var input BatchCreateWithExpirationsInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateWithExpirationsInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return BatchCreateWithExpirationsInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithExpirationsInput{}, false
			}
			for d.More() {
				item, ok := decodeBulkExpirationItem(d)
				if !ok || len(input.Items) == 20 {
					return BatchCreateWithExpirationsInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithExpirationsInput{}, false
			}
		default:
			return BatchCreateWithExpirationsInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithExpirationsInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithExpirationsInput{}, false
	}
	return input, true
}

// decodeBulkExpirationItem preserves raw strings and requires a non-null bounded string tag array.
func decodeBulkExpirationItem(d *json.Decoder) (BatchCreateExpirationItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateExpirationItem{}, false
	}
	var item BatchCreateExpirationItem
	seen := make(map[string]bool, 6)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateExpirationItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return BatchCreateExpirationItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateExpirationItem{}, false
			}
			item.Tags = []string{}
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return BatchCreateExpirationItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateExpirationItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return BatchCreateExpirationItem{}, false
		}
		switch key {
		case "targetUrl":
			item.TargetURL = value
		case "title":
			item.Title = value
		case "customSlug":
			item.CustomSlug = value
		case "redirectMode":
			item.RedirectMode = value
		case "expiresAt":
			item.ExpiresAt = value
		default:
			return BatchCreateExpirationItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 6
}
