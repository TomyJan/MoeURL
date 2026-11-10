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
	"strconv"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// BatchCreateWithTitlesPort keeps title imports optional and independent of the legacy API.
type BatchCreateWithTitlesPort interface {
	BatchCreateWithTitles(context.Context, auth.CurrentUser, BatchCreateWithTitlesInput) (BatchCreateResult, error)
}

// BulkCreateTitlesHandler decodes bounded strict title imports before any business write.
type BulkCreateTitlesHandler struct {
	service BatchCreateWithTitlesPort
	logger  *slog.Logger
}

// NewBulkCreateTitlesHandler binds title imports to the application's structured logger.
func NewBulkCreateTitlesHandler(service BatchCreateWithTitlesPort, logger *slog.Logger) *BulkCreateTitlesHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BulkCreateTitlesHandler{service: service, logger: logger}
}

// BatchCreateWithTitles rejects ambiguous nested fields and stale browser account intent.
func (h *BulkCreateTitlesHandler) BatchCreateWithTitles(w http.ResponseWriter, r *http.Request) {
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
	input, valid := decodeBulkCreateWithTitles(body)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	if _, _, err := normalizeBulkCreateWithTitles(input); err != nil {
		writeBulkCreateResult(w, r, BatchCreateResult{}, err, h.logger)
		return
	}
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != auth.UserFromContext(r.Context()).ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.BatchCreateWithTitles(r.Context(), auth.UserFromContext(r.Context()), input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// validBulkTitleUnicodeEscapes rejects lossy JSON surrogate replacement before decoding or hashing.
// Escaped backslashes are skipped; real U+FFFD and valid high/low pairs remain legal input.
func validBulkTitleUnicodeEscapes(body []byte) bool {
	for i := 0; i+1 < len(body); i++ {
		if body[i] != '\\' {
			continue
		}
		i++
		if body[i] != 'u' {
			continue
		}
		if i+4 >= len(body) {
			return false
		}
		unit, err := strconv.ParseUint(string(body[i+1:i+5]), 16, 16)
		if err != nil {
			return false
		}
		i += 4
		if unit >= 0xd800 && unit <= 0xdbff {
			if i+6 >= len(body) || body[i+1] != '\\' || body[i+2] != 'u' {
				return false
			}
			low, err := strconv.ParseUint(string(body[i+3:i+7]), 16, 16)
			if err != nil || low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		} else if unit >= 0xdc00 && unit <= 0xdfff {
			return false
		}
	}
	return true
}

// decodeBulkCreateWithTitles requires exactly two top-level fields and a bounded non-null item array.
func decodeBulkCreateWithTitles(body []byte) (BatchCreateWithTitlesInput, bool) {
	decoder := json.NewDecoder(bytes.NewReader(body))
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateWithTitlesInput{}, false
	}
	var input BatchCreateWithTitlesInput
	seen := make(map[string]bool, 2)
	for decoder.More() {
		token, err := decoder.Token()
		key, isString := token.(string)
		if err != nil || !isString || seen[key] {
			return BatchCreateWithTitlesInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			value, err := decoder.Token()
			var valid bool
			input.RequestID, valid = value.(string)
			if err != nil || !valid {
				return BatchCreateWithTitlesInput{}, false
			}
		case "items":
			opening, err := decoder.Token()
			if err != nil || opening != json.Delim('[') {
				return BatchCreateWithTitlesInput{}, false
			}
			for decoder.More() {
				item, valid := decodeBulkTitleItem(decoder)
				if !valid || len(input.Items) == 20 {
					return BatchCreateWithTitlesInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := decoder.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return BatchCreateWithTitlesInput{}, false
			}
		default:
			return BatchCreateWithTitlesInput{}, false
		}
	}
	closing, err := decoder.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return BatchCreateWithTitlesInput{}, false
	}
	if err := decoder.Decode(new(any)); !errors.Is(err, io.EOF) {
		return BatchCreateWithTitlesInput{}, false
	}
	return input, true
}

// decodeBulkTitleItem rejects duplicate, missing, non-string and unknown nested fields.
func decodeBulkTitleItem(decoder *json.Decoder) (BatchCreateItem, bool) {
	opening, err := decoder.Token()
	if err != nil || opening != json.Delim('{') {
		return BatchCreateItem{}, false
	}
	var item BatchCreateItem
	seen := make(map[string]bool, 2)
	for decoder.More() {
		token, err := decoder.Token()
		key, valid := token.(string)
		if err != nil || !valid || seen[key] {
			return BatchCreateItem{}, false
		}
		seen[key] = true
		token, err = decoder.Token()
		value, valid := token.(string)
		if err != nil || !valid {
			return BatchCreateItem{}, false
		}
		switch key {
		case "targetUrl":
			item.TargetURL = value
		case "title":
			item.Title = value
		default:
			return BatchCreateItem{}, false
		}
	}
	closing, err := decoder.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 2
}
