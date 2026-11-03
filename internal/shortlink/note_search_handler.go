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

// NoteSearchPort isolates private read-only search and exports from the legacy GET ports.
type NoteSearchPort interface {
	SearchOwnNotes(context.Context, auth.CurrentUser, NoteSearchInput) (ListResult, error)
	SearchAdminNotes(context.Context, auth.CurrentUser, NoteSearchInput) (AdminListResult, error)
	ExportOwnNoteSearch(context.Context, auth.CurrentUser, NoteSearchInput) (ListExport, error)
	ExportAdminNoteSearch(context.Context, auth.CurrentUser, NoteSearchInput) (ListExport, error)
}

// NoteSearchHandler frames private searches without logging any untrusted input.
type NoteSearchHandler struct {
	service NoteSearchPort
	logger  *slog.Logger
}

// NewNoteSearchHandler binds the independent search port and safe logger.
func NewNoteSearchHandler(service NoteSearchPort, logger *slog.Logger) *NoteSearchHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &NoteSearchHandler{service: service, logger: logger}
}

// List serves personal private-keyword searches.
func (h *NoteSearchHandler) List(w http.ResponseWriter, r *http.Request) { h.serve(w, r, false, false) }

// AdminList serves globally authorized private-keyword searches.
func (h *NoteSearchHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, true, false)
}

// Export serves all personally authorized matches without pagination.
func (h *NoteSearchHandler) Export(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, false, true)
}

// AdminExport serves all globally authorized matches without pagination.
func (h *NoteSearchHandler) AdminExport(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, true, true)
}

// fail redacts infrastructure details, which could contain private SQL parameters.
func (h *NoteSearchHandler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrListExportLimit) {
		businessError(w, 200118, "Short link export limit exceeded")
		return
	}
	if !errors.Is(err, ErrInvalidInput) && !errors.Is(err, ErrInvalidStatus) && !errors.Is(err, ErrPermissionDenied) {
		err = errors.New("short_link_note_search_failed")
	}
	writeBusinessOrSystemError(w, r, h.logger, err)
}

// serve validates identity and framing before executing one authorized, read-only operation.
func (h *NoteSearchHandler) serve(w http.ResponseWriter, r *http.Request, admin, export bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	media, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
		h.fail(w, r, ErrInvalidInput)
		return
	}
	input, err := decodeNoteSearch(r.Body, export)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	if export {
		var result ListExport
		if admin {
			result, err = h.service.ExportAdminNoteSearch(r.Context(), actor, input)
		} else {
			result, err = h.service.ExportOwnNoteSearch(r.Context(), actor, input)
		}
		if err != nil {
			h.fail(w, r, err)
			return
		}
		ok(w, result)
		return
	}
	var items any
	var page, pageSize int32
	var total int64
	if admin {
		result, e := h.service.SearchAdminNotes(r.Context(), actor, input)
		err = e
		items, page, pageSize, total = result.Items, result.Page, result.PageSize, result.Total
	} else {
		result, e := h.service.SearchOwnNotes(r.Context(), actor, input)
		err = e
		items, page, pageSize, total = result.Items, result.Page, result.PageSize, result.Total
	}
	if err != nil {
		h.fail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, response{Code: 0, Message: "OK", Data: map[string]any{"items": items}, Meta: map[string]any{"page": page, "pageSize": pageSize, "total": total}})
}

// decodeNoteSearch accepts exactly the documented fields and rejects lossy JSON coercions.
func decodeNoteSearch(body io.Reader, export bool) (NoteSearchInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 16385))
	if err != nil || len(raw) > 16384 || !utf8.Valid(raw) {
		return NoteSearchInput{}, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return NoteSearchInput{}, ErrInvalidInput
	}
	fields := map[string]json.RawMessage{}
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return NoteSearchInput{}, ErrInvalidInput
		}
		key := token.(string) // An object key accepted by Decoder.Token is a string.
		if _, exists := fields[key]; exists {
			return NoteSearchInput{}, ErrInvalidInput
		}
		switch key {
		case "status", "q", "tag", "noteStatus", "noteQuery":
		case "page", "pageSize":
			if export {
				return NoteSearchInput{}, ErrInvalidInput
			}
		default:
			return NoteSearchInput{}, ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return NoteSearchInput{}, ErrInvalidInput
		}
		fields[key] = value
	}
	if _, err = d.Token(); err != nil || !errors.Is(d.Decode(new(any)), io.EOF) {
		return NoteSearchInput{}, ErrInvalidInput
	}
	want := 7
	if export {
		want = 5
	}
	if len(fields) != want {
		return NoteSearchInput{}, ErrInvalidInput
	}
	strings := map[string]string{}
	for _, key := range []string{"status", "q", "tag", "noteStatus", "noteQuery"} {
		if !validNoteJSONString(fields[key]) {
			return NoteSearchInput{}, ErrInvalidInput
		}
		var value string
		_ = json.Unmarshal(fields[key], &value)
		strings[key] = value
	}
	input := NoteSearchInput{ListInput: ListInput{Status: strings["status"], Query: strings["q"], Tag: strings["tag"], NoteStatus: strings["noteStatus"]}, NoteQuery: strings["noteQuery"]}
	if !export {
		var valid bool
		input.Page, valid = noteSearchInteger(fields["page"])
		if !valid {
			return NoteSearchInput{}, ErrInvalidInput
		}
		input.PageSize, valid = noteSearchInteger(fields["pageSize"])
		if !valid {
			return NoteSearchInput{}, ErrInvalidInput
		}
	}
	word, err := validateNoteSearch(input, export)
	if err != nil {
		return NoteSearchInput{}, err
	}
	input.NoteQuery = word
	return input, nil
}

// noteSearchInteger accepts only canonical positive decimal int32 pagination values.
func noteSearchInteger(raw []byte) (int32, bool) {
	if len(raw) == 0 || raw[0] < '1' || raw[0] > '9' {
		return 0, false
	}
	for _, b := range raw {
		if b < '0' || b > '9' {
			return 0, false
		}
	}
	v, err := strconv.ParseInt(string(raw), 10, 32)
	return int32(v), err == nil
}
