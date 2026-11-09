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

type BatchNoteAppendPort interface {
	PreviewOwnNoteAppend(context.Context, auth.CurrentUser, BatchNoteAppendPreviewInput) (BatchNoteAppendPreviewResult, error)
	PreviewAdminNoteAppend(context.Context, auth.CurrentUser, BatchNoteAppendPreviewInput) (BatchNoteAppendPreviewResult, error)
	AppendOwnNotes(context.Context, auth.CurrentUser, BatchNoteAppendInput) (BatchNoteAppendResult, error)
	AppendAdminNotes(context.Context, auth.CurrentUser, BatchNoteAppendInput) (BatchNoteAppendResult, error)
}

type BatchNoteAppendHandler struct {
	service BatchNoteAppendPort
	logger  *slog.Logger
}

// NewBatchNoteAppendHandler binds the append operations with a safe default logger.
func NewBatchNoteAppendHandler(service BatchNoteAppendPort, logger *slog.Logger) *BatchNoteAppendHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchNoteAppendHandler{service: service, logger: logger}
}

func (h *BatchNoteAppendHandler) PreviewOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, false)
}

func (h *BatchNoteAppendHandler) PreviewAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, false)
}

func (h *BatchNoteAppendHandler) AppendOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, true)
}

func (h *BatchNoteAppendHandler) AppendAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, true)
}

// handle validates framing before dispatch and never logs request contents.
func (h *BatchNoteAppendHandler) handle(w http.ResponseWriter, r *http.Request, admin, write bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	var result any
	if err == nil {
		media, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
			err = ErrInvalidInput
		} else {
			requestID, items, note, decodeErr := decodeBatchNoteAppend(r.Body, write)
			err = decodeErr
			if err == nil {
				if write {
					input := BatchNoteAppendInput{RequestID: requestID, Items: items, Note: note}
					if admin {
						result, err = h.service.AppendAdminNotes(r.Context(), actor, input)
					} else {
						result, err = h.service.AppendOwnNotes(r.Context(), actor, input)
					}
				} else {
					input := BatchNoteAppendPreviewInput{Items: make([]BatchNotePreviewItem, len(items)), Note: note}
					for i, item := range items {
						input.Items[i] = BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
					}
					if admin {
						result, err = h.service.PreviewAdminNoteAppend(r.Context(), actor, input)
					} else {
						result, err = h.service.PreviewOwnNoteAppend(r.Context(), actor, input)
					}
				}
			}
		}
	}
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_note_append_failed")
}

// decodeBatchNoteAppend preserves raw nested bytes to reject duplicate keys and invalid Unicode.
func decodeBatchNoteAppend(body io.Reader, write bool) (string, []BatchNoteClearItem, string, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 65537))
	if err != nil || len(raw) > 65536 || !utf8.Valid(raw) {
		return "", nil, "", ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return "", nil, "", ErrInvalidInput
	}
	fields := make(map[string]json.RawMessage, 3)
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return "", nil, "", ErrInvalidInput
		}
		key, ok := token.(string)
		if !ok || (key != "items" && key != "note" && !(write && key == "requestId")) {
			return "", nil, "", ErrInvalidInput
		}
		if _, exists := fields[key]; exists {
			return "", nil, "", ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return "", nil, "", ErrInvalidInput
		}
		fields[key] = value
	}
	wantFields := 2
	if write {
		wantFields = 3
	}
	if _, err = d.Token(); err != nil || len(fields) != wantFields || !errors.Is(d.Decode(new(any)), io.EOF) {
		return "", nil, "", ErrInvalidInput
	}
	if !validNoteJSONString(fields["note"]) {
		return "", nil, "", ErrInvalidInput
	}
	var note string
	_ = json.Unmarshal(fields["note"], &note)
	note, err = normalizeNote(note)
	if err != nil || note == "" {
		return "", nil, "", ErrInvalidInput
	}
	requestID := ""
	if write {
		if !validNoteJSONString(fields["requestId"]) {
			return "", nil, "", ErrInvalidInput
		}
		_ = json.Unmarshal(fields["requestId"], &requestID)
		if _, err = parseNoteID(requestID); err != nil {
			return "", nil, "", ErrInvalidInput
		}
	}
	itemsRaw := append([]byte(`{"items":`), fields["items"]...)
	itemsRaw = append(itemsRaw, '}')
	items, err := decodeBatchNoteItems(bytes.NewReader(itemsRaw), write)
	if err != nil {
		return "", nil, "", err
	}
	return requestID, items, note, nil
}
