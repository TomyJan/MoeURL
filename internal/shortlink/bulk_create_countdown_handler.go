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

// BatchCreateWithCountdownsPort independently exposes the strictly bounded eighth protocol.
type BatchCreateWithCountdownsPort interface {
	BatchCreateWithCountdowns(context.Context, auth.CurrentUser, BatchCreateWithCountdownsInput) (BatchCreateResult, error)
}

// BulkCreateCountdownHandler binds a strict countdown batch endpoint to its service.
type BulkCreateCountdownHandler struct {
	service BatchCreateWithCountdownsPort
	logger  *slog.Logger
}

// NewBulkCreateCountdownHandler preserves application logging without retaining raw requests.
func NewBulkCreateCountdownHandler(service BatchCreateWithCountdownsPort, logger *slog.Logger) *BulkCreateCountdownHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateCountdownHandler{service: service, logger: logger}
}

// BatchCreateWithCountdowns rejects malformed or stale-account writes before calling the service.
func (h *BulkCreateCountdownHandler) BatchCreateWithCountdowns(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithCountdowns(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithCountdowns(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithCountdowns(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithCountdowns rejects missing, duplicate, unknown and trailing fields.
func decodeBulkCreateWithCountdowns(body []byte) (BatchCreateWithCountdownsInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithCountdownsInput{}, false
	}
	var input BatchCreateWithCountdownsInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateWithCountdownsInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return BatchCreateWithCountdownsInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithCountdownsInput{}, false
			}
			for d.More() {
				item, ok := decodeBulkCountdownItem(d)
				if !ok || len(input.Items) == 20 {
					return BatchCreateWithCountdownsInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithCountdownsInput{}, false
			}
		default:
			return BatchCreateWithCountdownsInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithCountdownsInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithCountdownsInput{}, false
	}
	return input, true
}

// decodeBulkCountdownItem preserves raw strings and requires a non-null bounded string tag array.
func decodeBulkCountdownItem(d *json.Decoder) (BatchCreateCountdownItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateCountdownItem{}, false
	}
	var item BatchCreateCountdownItem
	seen := make(map[string]bool, 8)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateCountdownItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return BatchCreateCountdownItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateCountdownItem{}, false
			}
			item.Tags = []string{}
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return BatchCreateCountdownItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateCountdownItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return BatchCreateCountdownItem{}, false
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
		case "maxVisits":
			item.MaxVisits = value
		case "intermediateDelaySeconds":
			item.IntermediateDelaySeconds = value
		default:
			return BatchCreateCountdownItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 8
}
