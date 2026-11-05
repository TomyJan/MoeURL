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

// BatchTagRenamePort exposes the two independent selection-scoped rename operations.
type BatchTagRenamePort interface {
	RenameOwnTags(context.Context, auth.CurrentUser, BatchTagRenameInput) (BatchTagsResult, error)
	RenameAdminTags(context.Context, auth.CurrentUser, BatchTagRenameInput) (BatchTagsResult, error)
}

// BatchTagRenameHandler decodes strict requests without logging tag text.
type BatchTagRenameHandler struct {
	service BatchTagRenamePort
	logger  *slog.Logger
}

// NewBatchTagRenameHandler binds rename endpoints with a safe default logger.
func NewBatchTagRenameHandler(service BatchTagRenamePort, logger *slog.Logger) *BatchTagRenameHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &BatchTagRenameHandler{service, logger}
}

// RenameOwn handles the current owner's fixed selection.
func (h *BatchTagRenameHandler) RenameOwn(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, false)
}

// RenameAdmin handles a permitted administrator's fixed selection.
func (h *BatchTagRenameHandler) RenameAdmin(w http.ResponseWriter, r *http.Request) {
	h.handle(w, r, true)
}

func (h *BatchTagRenameHandler) handle(w http.ResponseWriter, r *http.Request, admin bool) {
	w.Header().Set("Cache-Control", "no-store")
	actor, err := noteActor(r)
	var result BatchTagsResult
	if err == nil {
		media, _, mediaErr := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if mediaErr != nil || media != "application/json" || r.URL.RawQuery != "" || r.URL.ForceQuery {
			err = ErrInvalidInput
		} else {
			var input BatchTagRenameInput
			input, err = decodeBatchTagRename(r.Body)
			if err == nil {
				if admin {
					result, err = h.service.RenameAdminTags(r.Context(), actor, input)
				} else {
					result, err = h.service.RenameOwnTags(r.Context(), actor, input)
				}
			}
		}
	}
	writeTransferResult(w, r, result, err, h.logger, "short_link_batch_tag_rename_failed")
}

// decodeBatchTagRename keeps raw nested bytes so duplicate keys and invalid Unicode remain detectable.
func decodeBatchTagRename(body io.Reader) (BatchTagRenameInput, error) {
	var input BatchTagRenameInput
	raw, err := io.ReadAll(io.LimitReader(body, 65537))
	if err != nil || len(raw) > 65536 || !utf8.Valid(raw) {
		return input, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return input, ErrInvalidInput
	}
	fields := make(map[string]json.RawMessage, 3)
	for d.More() {
		token, err = d.Token()
		if err != nil {
			return input, ErrInvalidInput
		}
		key, ok := token.(string)
		if !ok || (key != "items" && key != "fromTag" && key != "toTag") {
			return input, ErrInvalidInput
		}
		if _, exists := fields[key]; exists {
			return input, ErrInvalidInput
		}
		var value json.RawMessage
		if d.Decode(&value) != nil {
			return input, ErrInvalidInput
		}
		fields[key] = value
	}
	if _, err = d.Token(); err != nil || len(fields) != 3 || !errors.Is(d.Decode(new(any)), io.EOF) {
		return input, ErrInvalidInput
	}
	for _, key := range []string{"fromTag", "toTag"} {
		if !validNoteJSONString(fields[key]) {
			return input, ErrInvalidInput
		}
	}
	_ = json.Unmarshal(fields["fromTag"], &input.FromTag)
	_ = json.Unmarshal(fields["toTag"], &input.ToTag)
	wrapped := append([]byte(`{"items":`), fields["items"]...)
	wrapped = append(wrapped, '}')
	items, err := decodeBatchNoteItems(bytes.NewReader(wrapped), false)
	if err != nil {
		return input, err
	}
	input.Items = make([]BatchTagItem, len(items))
	for i, item := range items {
		input.Items[i] = BatchTagItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
	}
	_, _, input.FromTag, input.ToTag, err = normalizeBatchTagRename(input)
	return input, err
}
