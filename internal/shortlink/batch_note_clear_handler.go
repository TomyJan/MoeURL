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

type BatchNoteClearPort interface {
	PreviewOwnNoteClear(context.Context, auth.CurrentUser, BatchNotePreviewInput) (BatchNotePreviewResult, error)
	PreviewAdminNoteClear(context.Context, auth.CurrentUser, BatchNotePreviewInput) (BatchNotePreviewResult, error)
	ClearOwnNotes(context.Context, auth.CurrentUser, BatchNoteClearInput) (BatchNoteClearResult, error)
	ClearAdminNotes(context.Context, auth.CurrentUser, BatchNoteClearInput) (BatchNoteClearResult, error)
}

type BatchNoteClearHandler struct {
	service BatchNoteClearPort
	logger  *slog.Logger
}

// NewBatchNoteClearHandler binds the four private-note endpoints and uses the default logger when none is supplied.
func NewBatchNoteClearHandler(service BatchNoteClearPort, logger *slog.Logger) *BatchNoteClearHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchNoteClearHandler{service, logger}
}

func (h *BatchNoteClearHandler) PreviewOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, false)
}
func (h *BatchNoteClearHandler) PreviewAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, false)
}
func (h *BatchNoteClearHandler) ClearOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false, true)
}
func (h *BatchNoteClearHandler) ClearAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true, true)
}

// handle rejects query parameters and non-JSON bodies before dispatching the authenticated actor to the requested scope and operation.
func (h *BatchNoteClearHandler) handle(w http.ResponseWriter, r *http.Request, admin, clear bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	var result any
	if err == nil {
		media, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
			err = ErrInvalidInput
		} else {
			var items []BatchNoteClearItem
			items, err = decodeBatchNoteItems(r.Body, clear)
			if err == nil {
				if clear {
					input := BatchNoteClearInput{Items: items}
					if admin {
						result, err = h.service.ClearAdminNotes(r.Context(), actor, input)
					} else {
						result, err = h.service.ClearOwnNotes(r.Context(), actor, input)
					}
				} else {
					input := BatchNotePreviewInput{Items: make([]BatchNotePreviewItem, len(items))}
					for i, item := range items {
						input.Items[i] = BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
					}
					if admin {
						result, err = h.service.PreviewAdminNoteClear(r.Context(), actor, input)
					} else {
						result, err = h.service.PreviewOwnNoteClear(r.Context(), actor, input)
					}
				}
			}
		}
	}
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_note_clear_failed")
}

// decodeBatchNoteItems bounds raw reads, disallows duplicate keys and validates scalars before dispatch.
func decodeBatchNoteItems(body io.Reader, clear bool) ([]BatchNoteClearItem, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 65537))
	if err != nil || len(raw) > 65536 || !utf8.Valid(raw) {
		return nil, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return nil, ErrInvalidInput
	}
	token, err = d.Token()
	if err != nil || token != "items" {
		return nil, ErrInvalidInput
	}
	token, err = d.Token()
	if err != nil || token != json.Delim('[') {
		return nil, ErrInvalidInput
	}
	items := make([]BatchNoteClearItem, 0)
	for d.More() {
		if len(items) == 100 {
			return nil, ErrInvalidInput
		}
		token, err = d.Token()
		if err != nil || token != json.Delim('{') {
			return nil, ErrInvalidInput
		}
		fields := map[string]string{}
		for d.More() {
			token, err = d.Token()
			if err != nil {
				return nil, ErrInvalidInput
			}
			key, valid := token.(string)
			if !valid || (key != "id" && key != "expectedUpdatedAt" && !(clear && key == "expectedNoteUpdatedAt")) {
				return nil, ErrInvalidInput
			}
			if _, exists := fields[key]; exists {
				return nil, ErrInvalidInput
			}
			var scalar json.RawMessage
			if d.Decode(&scalar) != nil || !validNoteJSONString(scalar) {
				return nil, ErrInvalidInput
			}
			var value string
			_ = json.Unmarshal(scalar, &value)
			fields[key] = value
		}
		want := 2
		if clear {
			want = 3
		}
		if _, err = d.Token(); err != nil || len(fields) != want {
			return nil, ErrInvalidInput
		}
		items = append(items, BatchNoteClearItem{ID: fields["id"], ExpectedUpdatedAt: fields["expectedUpdatedAt"], ExpectedNoteUpdatedAt: fields["expectedNoteUpdatedAt"]})
	}
	if _, err = d.Token(); err != nil {
		return nil, ErrInvalidInput
	}
	if d.More() {
		return nil, ErrInvalidInput
	}
	if _, err = d.Token(); err != nil || !errors.Is(d.Decode(new(any)), io.EOF) {
		return nil, ErrInvalidInput
	}
	if _, _, err = normalizeBatchNoteItems(items, clear); err != nil {
		return nil, err
	}
	return items, nil
}
