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

// BatchCreateWithRedirectModesPort independently exposes the strictly bounded fifth protocol.
type BatchCreateWithRedirectModesPort interface {
	BatchCreateWithRedirectModes(context.Context, auth.CurrentUser, BatchCreateWithRedirectModesInput) (BatchCreateResult, error)
}

// BulkCreateRedirectModeHandler binds a strict redirect-mode batch endpoint to its service.
type BulkCreateRedirectModeHandler struct {
	service BatchCreateWithRedirectModesPort
	logger  *slog.Logger
}

// NewBulkCreateRedirectModeHandler preserves application logging without retaining raw requests.
func NewBulkCreateRedirectModeHandler(service BatchCreateWithRedirectModesPort, logger *slog.Logger) *BulkCreateRedirectModeHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateRedirectModeHandler{service: service, logger: logger}
}

// BatchCreateWithRedirectModes rejects malformed or stale-account writes before calling the service.
func (h *BulkCreateRedirectModeHandler) BatchCreateWithRedirectModes(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithRedirectModes(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithRedirectModes(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithRedirectModes(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithRedirectModes rejects missing, duplicate, unknown and trailing fields.
func decodeBulkCreateWithRedirectModes(body []byte) (BatchCreateWithRedirectModesInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithRedirectModesInput{}, false
	}
	var input BatchCreateWithRedirectModesInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateWithRedirectModesInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return BatchCreateWithRedirectModesInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithRedirectModesInput{}, false
			}
			for d.More() {
				item, ok := decodeBulkRedirectModeItem(d)
				if !ok || len(input.Items) == 20 {
					return BatchCreateWithRedirectModesInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithRedirectModesInput{}, false
			}
		default:
			return BatchCreateWithRedirectModesInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithRedirectModesInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithRedirectModesInput{}, false
	}
	return input, true
}

// decodeBulkRedirectModeItem preserves raw strings and requires a non-null bounded string tag array.
func decodeBulkRedirectModeItem(d *json.Decoder) (BatchCreateRedirectModeItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateRedirectModeItem{}, false
	}
	var item BatchCreateRedirectModeItem
	seen := make(map[string]bool, 5)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateRedirectModeItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return BatchCreateRedirectModeItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateRedirectModeItem{}, false
			}
			item.Tags = []string{}
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return BatchCreateRedirectModeItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateRedirectModeItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return BatchCreateRedirectModeItem{}, false
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
		default:
			return BatchCreateRedirectModeItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 5
}
