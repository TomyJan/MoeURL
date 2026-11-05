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

type BatchNoteReplacePort interface {
	PreviewOwnNoteReplace(context.Context, auth.CurrentUser, BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error)
	PreviewAdminNoteReplace(context.Context, auth.CurrentUser, BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error)
	ReplaceOwnNotes(context.Context, auth.CurrentUser, BatchNoteReplaceInput) (BatchNoteClearResult, error)
	ReplaceAdminNotes(context.Context, auth.CurrentUser, BatchNoteReplaceInput) (BatchNoteClearResult, error)
}

type BatchNoteReplaceHandler struct {
	service BatchNoteReplacePort
	logger  *slog.Logger
}

// NewBatchNoteReplaceHandler binds the private replacement operations with a safe default logger.
func NewBatchNoteReplaceHandler(service BatchNoteReplacePort, logger *slog.Logger) *BatchNoteReplaceHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchNoteReplaceHandler{service: service, logger: logger}
}

func (h *BatchNoteReplaceHandler) PreviewOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, false)
}
func (h *BatchNoteReplaceHandler) PreviewAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, false)
}
func (h *BatchNoteReplaceHandler) ReplaceOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, true)
}
func (h *BatchNoteReplaceHandler) ReplaceAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, true)
}

// handle validates framing before dispatch and never logs the note or request body.
func (h *BatchNoteReplaceHandler) handle(w http.ResponseWriter, r *http.Request, admin, write bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	var result any
	if err == nil {
		media, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
			err = ErrInvalidInput
		} else {
			var items []BatchNoteClearItem
			var note string
			items, note, err = decodeBatchNoteReplace(r.Body, write)
			if err == nil {
				if write {
					input := BatchNoteReplaceInput{Items: items, Note: note}
					if admin {
						result, err = h.service.ReplaceAdminNotes(r.Context(), actor, input)
					} else {
						result, err = h.service.ReplaceOwnNotes(r.Context(), actor, input)
					}
				} else {
					input := BatchNoteReplacePreviewInput{Items: make([]BatchNotePreviewItem, len(items)), Note: note}
					for i, item := range items {
						input.Items[i] = BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
					}
					if admin {
						result, err = h.service.PreviewAdminNoteReplace(r.Context(), actor, input)
					} else {
						result, err = h.service.PreviewOwnNoteReplace(r.Context(), actor, input)
					}
				}
			}
		}
	}
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_note_replace_failed")
}

// decodeBatchNoteReplace preserves raw nested bytes so duplicate keys and invalid Unicode cannot be erased by unmarshalling.
func decodeBatchNoteReplace(body io.Reader, write bool) ([]BatchNoteClearItem, string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 65537))
	if err != nil || len(raw) > 65536 || !utf8.Valid(raw) {
		return nil, "", ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, "", ErrInvalidInput
	}
	fields := make(map[string]json.RawMessage, 2)
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return nil, "", ErrInvalidInput
		}
		key, ok := token.(string)
		if !ok || (key != "items" && key != "note") {
			return nil, "", ErrInvalidInput
		}
		if _, exists := fields[key]; exists {
			return nil, "", ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return nil, "", ErrInvalidInput
		}
		fields[key] = value
	}
	if _, err = d.Token(); err != nil || len(fields) != 2 || !errors.Is(d.Decode(new(any)), io.EOF) {
		return nil, "", ErrInvalidInput
	}
	if !validNoteJSONString(fields["note"]) {
		return nil, "", ErrInvalidInput
	}
	var note string
	_ = json.Unmarshal(fields["note"], &note)
	note, err = normalizeNote(note)
	if err != nil || note == "" {
		return nil, "", ErrInvalidInput
	}
	itemsRaw := append([]byte(`{"items":`), fields["items"]...)
	itemsRaw = append(itemsRaw, '}')
	items, err := decodeBatchNoteItems(bytes.NewReader(itemsRaw), write)
	if err != nil {
		return nil, "", err
	}
	return items, note, nil
}
