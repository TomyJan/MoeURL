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
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// NotePort keeps private note endpoints independent of the legacy metadata object.
type NotePort interface {
	ReadOwnNote(context.Context, auth.CurrentUser, string) (NoteResult, error)
	ReadAdminNote(context.Context, auth.CurrentUser, string) (NoteResult, error)
	UpdateOwnNote(context.Context, auth.CurrentUser, NoteInput) (NoteResult, error)
	UpdateAdminNote(context.Context, auth.CurrentUser, NoteInput) (NoteResult, error)
}

// NoteHandler strictly frames private reads and writes, without logging their text.
type NoteHandler struct {
	service NotePort
	logger  *slog.Logger
}

// NewNoteHandler binds the fixed note port and safe request logger.
func NewNoteHandler(service NotePort, logger *slog.Logger) *NoteHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &NoteHandler{service, logger}
}

// ReadOwn serves only the current actor's personal note endpoint.
func (h *NoteHandler) ReadOwn(w http.ResponseWriter, r *http.Request) { h.read(w, r, false) }

// ReadAdmin serves the separately authorized global note endpoint.
func (h *NoteHandler) ReadAdmin(w http.ResponseWriter, r *http.Request) { h.read(w, r, true) }

// UpdateOwn decodes one complete personal note replacement.
func (h *NoteHandler) UpdateOwn(w http.ResponseWriter, r *http.Request) { h.update(w, r, false) }

// UpdateAdmin decodes one complete globally authorized note replacement.
func (h *NoteHandler) UpdateAdmin(w http.ResponseWriter, r *http.Request) { h.update(w, r, true) }

// noteActor binds an optional expected identity to the actual Cookie actor, never granting identity.
func noteActor(r *http.Request) (auth.CurrentUser, error) {
	actor := auth.UserFromContext(r.Context())
	values, exists := r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")]
	if exists {
		if len(values) != 1 {
			return actor, ErrPermissionDenied
		}
		if _, err := parseNoteID(values[0]); err != nil || values[0] != actor.ID {
			return actor, ErrPermissionDenied
		}
	}
	return actor, nil
}

// read rejects ambiguous framing and mismatched identities before accessing private text.
func (h *NoteHandler) read(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	if err != nil {
		h.result(w, r, NoteResult{}, err)
		return
	}
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil || len(values) != 1 || len(values["id"]) != 1 || !strings.Contains(r.URL.RawQuery, "=") || strings.Contains(r.URL.RawQuery, "&") {
		h.result(w, r, NoteResult{}, ErrInvalidInput)
		return
	}
	var result NoteResult
	if admin {
		result, err = h.service.ReadAdminNote(r.Context(), actor, values.Get("id"))
	} else {
		result, err = h.service.ReadOwnNote(r.Context(), actor, values.Get("id"))
	}
	h.result(w, r, result, err)
}

// update enforces the whole raw body bound, required fields and strict scalar strings.
func (h *NoteHandler) update(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	if err != nil {
		h.result(w, r, NoteResult{}, err)
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" {
		h.result(w, r, NoteResult{}, ErrInvalidInput)
		return
	}
	input, err := decodeNoteInput(r.Body)
	if err != nil {
		h.result(w, r, NoteResult{}, err)
		return
	}
	var result NoteResult
	if admin {
		result, err = h.service.UpdateAdminNote(r.Context(), actor, input)
	} else {
		result, err = h.service.UpdateOwnNote(r.Context(), actor, input)
	}
	h.result(w, r, result, err)
}

// result reuses the link conflict contract and safe, text-free infrastructure diagnostics.
func (h *NoteHandler) result(w http.ResponseWriter, r *http.Request, result NoteResult, err error) {
	writeTransferResult(w, r, result, err, h.logger, "short_link_note_failed")
}

// decodeNoteInput requires exactly three non-null strings and no duplicate or trailing JSON.
func decodeNoteInput(body io.Reader) (NoteInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 16385))
	if err != nil {
		return NoteInput{}, ErrInvalidInput
	}
	if len(raw) > 16384 || !utf8.Valid(raw) {
		return NoteInput{}, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return NoteInput{}, ErrInvalidInput
	}
	fields := map[string]string{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return NoteInput{}, ErrInvalidInput
		}
		key, valid := token.(string)
		if !valid || (key != "id" && key != "note" && key != "expectedUpdatedAt") {
			return NoteInput{}, ErrInvalidInput
		}
		if _, exists := fields[key]; exists {
			return NoteInput{}, ErrInvalidInput
		}
		var scalar json.RawMessage
		if d.Decode(&scalar) != nil || !validNoteJSONString(scalar) {
			return NoteInput{}, ErrInvalidInput
		}
		var value string
		// Decode already validated the JSON and validNoteJSONString established its string type.
		_ = json.Unmarshal(scalar, &value)
		fields[key] = value
	}
	if _, err = d.Token(); err != nil {
		return NoteInput{}, ErrInvalidInput
	}
	if len(fields) != 3 || !errors.Is(d.Decode(new(any)), io.EOF) {
		return NoteInput{}, ErrInvalidInput
	}
	return NoteInput{ID: fields["id"], Note: fields["note"], ExpectedUpdatedAt: fields["expectedUpdatedAt"]}, nil
}

// validNoteJSONString checks a valid JSON RawMessage for string type and unpaired surrogate escapes.
// Its caller has already run Decoder.Decode, so escape framing and hex digits are valid JSON.
func validNoteJSONString(raw []byte) bool {
	if len(raw) < 2 || raw[0] != '"' || raw[len(raw)-1] != '"' {
		return false
	}
	for i := 1; i < len(raw)-1; i++ {
		if raw[i] != '\\' {
			continue
		}
		i++
		if raw[i] != 'u' {
			continue
		}
		v, _ := strconv.ParseUint(string(raw[i+1:i+5]), 16, 16)
		i += 4
		if v >= 0xdc00 && v <= 0xdfff {
			return false
		}
		if v >= 0xd800 && v <= 0xdbff {
			if i+6 >= len(raw) || raw[i+1] != '\\' || raw[i+2] != 'u' {
				return false
			}
			low, _ := strconv.ParseUint(string(raw[i+3:i+7]), 16, 16)
			if low < 0xdc00 || low > 0xdfff {
				return false
			}
			i += 6
		}
	}
	return true
}
