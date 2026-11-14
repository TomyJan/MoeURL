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

// BatchCreateWithVisitLimitsPort independently exposes the strictly bounded seventh protocol.
type BatchCreateWithVisitLimitsPort interface {
	BatchCreateWithVisitLimits(context.Context, auth.CurrentUser, BatchCreateWithVisitLimitsInput) (BatchCreateResult, error)
}

// BulkCreateVisitLimitHandler binds a strict visit-limit batch endpoint to its service.
type BulkCreateVisitLimitHandler struct {
	service BatchCreateWithVisitLimitsPort
	logger  *slog.Logger
}

// NewBulkCreateVisitLimitHandler preserves application logging without retaining raw requests.
func NewBulkCreateVisitLimitHandler(service BatchCreateWithVisitLimitsPort, logger *slog.Logger) *BulkCreateVisitLimitHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateVisitLimitHandler{service: service, logger: logger}
}

// BatchCreateWithVisitLimits rejects malformed or stale-account writes before calling the service.
func (h *BulkCreateVisitLimitHandler) BatchCreateWithVisitLimits(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithVisitLimits(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithVisitLimits(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithVisitLimits(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeBulkCreateWithVisitLimits rejects missing, duplicate, unknown and trailing fields.
func decodeBulkCreateWithVisitLimits(body []byte) (BatchCreateWithVisitLimitsInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithVisitLimitsInput{}, false
	}
	var input BatchCreateWithVisitLimitsInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateWithVisitLimitsInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return BatchCreateWithVisitLimitsInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithVisitLimitsInput{}, false
			}
			for d.More() {
				item, ok := decodeBulkVisitLimitItem(d)
				if !ok || len(input.Items) == 20 {
					return BatchCreateWithVisitLimitsInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithVisitLimitsInput{}, false
			}
		default:
			return BatchCreateWithVisitLimitsInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithVisitLimitsInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithVisitLimitsInput{}, false
	}
	return input, true
}

// decodeBulkVisitLimitItem preserves raw strings and requires a non-null bounded string tag array.
func decodeBulkVisitLimitItem(d *json.Decoder) (BatchCreateVisitLimitItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateVisitLimitItem{}, false
	}
	var item BatchCreateVisitLimitItem
	seen := make(map[string]bool, 7)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return BatchCreateVisitLimitItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return BatchCreateVisitLimitItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return BatchCreateVisitLimitItem{}, false
			}
			item.Tags = []string{}
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return BatchCreateVisitLimitItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return BatchCreateVisitLimitItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return BatchCreateVisitLimitItem{}, false
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
		default:
			return BatchCreateVisitLimitItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 7
}
