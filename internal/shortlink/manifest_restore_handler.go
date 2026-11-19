package shortlink

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

const manifestRestoreRequestLimit = 1 << 20
const manifestRestoreMaxItems = 100

// ManifestRestoreItem contains only data that can be reconstructed from the management CSV.
type ManifestRestoreItem struct {
	DomainOrigin             string   `json:"domainOrigin"`
	Slug                     string   `json:"slug"`
	TargetURL                string   `json:"targetUrl"`
	Title                    string   `json:"title"`
	Tags                     []string `json:"tags"`
	Status                   string   `json:"status"`
	RedirectMode             string   `json:"redirectMode"`
	IntermediateDelaySeconds string   `json:"intermediateDelaySeconds"`
	ExpiresAt                string   `json:"expiresAt"`
	MaxVisits                string   `json:"maxVisits"`
}

// ManifestRestoreInput binds the ordered manifest rows to one request id.
type ManifestRestoreInput struct {
	RequestID string                `json:"requestId"`
	Items     []ManifestRestoreItem `json:"items"`

	rawPayloadDigest [sha256.Size]byte `json:"-"`
	rawPayloadSize   int               `json:"-"`
}

// ManifestRestorePort restores a complete management manifest for the current actor.
type ManifestRestorePort interface {
	RestoreManifest(context.Context, auth.CurrentUser, ManifestRestoreInput) (BatchCreateResult, error)
}

// ManifestRestoreHandler enforces the manifest request envelope before handing it to the service.
type ManifestRestoreHandler struct {
	service ManifestRestorePort
	logger  *slog.Logger
}

// NewManifestRestoreHandler binds the atomic restore port and shared application logger.
func NewManifestRestoreHandler(service ManifestRestorePort, logger *slog.Logger) *ManifestRestoreHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &ManifestRestoreHandler{service: service, logger: logger}
}

// RestoreManifest rejects malformed or stale-actor requests before calling the service.
func (h *ManifestRestoreHandler) RestoreManifest(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.URL.ForceQuery {
		businessError(w, 100001, "Invalid request")
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" {
		businessError(w, 100001, "Invalid request")
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, manifestRestoreRequestLimit+1))
	if err != nil || len(body) > manifestRestoreRequestLimit || !utf8.Valid(body) || !validBulkTitleUnicodeEscapes(body) {
		businessError(w, 100001, "Invalid request")
		return
	}
	input, valid := decodeManifestRestore(body)
	if !valid || !validManifestRestoreEnvelope(input) {
		businessError(w, 100001, "Invalid request")
		return
	}
	actor := auth.UserFromContext(r.Context())
	expected := r.Header.Values("X-MoeURL-Expected-User-ID")
	if len(expected) > 0 && (len(expected) != 1 || expected[0] == "" || expected[0] != actor.ID) {
		businessError(w, 120001, "Permission denied")
		return
	}
	result, err := h.service.RestoreManifest(r.Context(), actor, input)
	writeBulkCreateResult(w, r, result, err, h.logger)
}

// decodeManifestRestore accepts only the closed two-key request and ten-key row schemas.
func decodeManifestRestore(body []byte) (ManifestRestoreInput, bool) {
	d := json.NewDecoder(bytes.NewReader(body))
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return ManifestRestoreInput{}, false
	}
	var input ManifestRestoreInput
	seen := make(map[string]bool, 2)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return ManifestRestoreInput{}, false
		}
		seen[key] = true
		switch key {
		case "requestId":
			token, err := d.Token()
			value, ok := token.(string)
			if err != nil || !ok {
				return ManifestRestoreInput{}, false
			}
			input.RequestID = value
		case "items":
			opening, err := d.Token()
			if err != nil || opening != json.Delim('[') {
				return ManifestRestoreInput{}, false
			}
			input.Items = make([]ManifestRestoreItem, 0, 1)
			for d.More() {
				if len(input.Items) == manifestRestoreMaxItems {
					return ManifestRestoreInput{}, false
				}
				item, ok := decodeManifestRestoreItem(d)
				if !ok {
					return ManifestRestoreInput{}, false
				}
				input.Items = append(input.Items, item)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') || len(input.Items) == 0 {
				return ManifestRestoreInput{}, false
			}
		default:
			return ManifestRestoreInput{}, false
		}
	}
	closing, err := d.Token()
	if err != nil || closing != json.Delim('}') || len(seen) != 2 {
		return ManifestRestoreInput{}, false
	}
	if err := d.Decode(new(any)); !errors.Is(err, io.EOF) {
		return ManifestRestoreInput{}, false
	}
	input.rawPayloadDigest = sha256.Sum256(body)
	input.rawPayloadSize = len(body)
	return input, true
}

func decodeManifestRestoreItem(d *json.Decoder) (ManifestRestoreItem, bool) {
	opening, err := d.Token()
	if err != nil || opening != json.Delim('{') {
		return ManifestRestoreItem{}, false
	}
	var item ManifestRestoreItem
	seen := make(map[string]bool, 10)
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || seen[key] {
			return ManifestRestoreItem{}, false
		}
		seen[key] = true
		token, err = d.Token()
		if err != nil {
			return ManifestRestoreItem{}, false
		}
		if key == "tags" {
			if token != json.Delim('[') {
				return ManifestRestoreItem{}, false
			}
			item.Tags = make([]string, 0)
			for d.More() {
				token, err := d.Token()
				tag, ok := token.(string)
				if err != nil || !ok || len(item.Tags) == 10 {
					return ManifestRestoreItem{}, false
				}
				item.Tags = append(item.Tags, tag)
			}
			closing, err := d.Token()
			if err != nil || closing != json.Delim(']') {
				return ManifestRestoreItem{}, false
			}
			continue
		}
		value, ok := token.(string)
		if !ok {
			return ManifestRestoreItem{}, false
		}
		switch key {
		case "domainOrigin":
			item.DomainOrigin = value
		case "slug":
			item.Slug = value
		case "targetUrl":
			item.TargetURL = value
		case "title":
			item.Title = value
		case "status":
			item.Status = value
		case "redirectMode":
			item.RedirectMode = value
		case "intermediateDelaySeconds":
			item.IntermediateDelaySeconds = value
		case "expiresAt":
			item.ExpiresAt = value
		case "maxVisits":
			item.MaxVisits = value
		default:
			return ManifestRestoreItem{}, false
		}
	}
	closing, err := d.Token()
	return item, err == nil && closing == json.Delim('}') && len(seen) == 10 && item.Tags != nil
}

func validManifestRestoreEnvelope(input ManifestRestoreInput) bool {
	requestID, err := uuid.Parse(input.RequestID)
	if err != nil || requestID == uuid.Nil || requestID.String() != input.RequestID || len(input.Items) == 0 || len(input.Items) > manifestRestoreMaxItems {
		return false
	}
	seen := make(map[string]struct{}, len(input.Items))
	for _, item := range input.Items {
		if _, ok := seen[item.Slug]; ok {
			return false
		}
		seen[item.Slug] = struct{}{}
	}
	return true
}
