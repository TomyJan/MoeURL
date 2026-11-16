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

// SelectedListExportPort isolates selected reads from legacy exports and all batch writes.
type SelectedListExportPort interface {
	ExportSelectedList(context.Context, auth.CurrentUser, SelectedListExportInput) (ListExport, error)
	AdminExportSelectedList(context.Context, auth.CurrentUser, SelectedListExportInput) (ListExport, error)
}

// SelectedListExportHandler frames one complete read without logging identifiers or private inputs.
type SelectedListExportHandler struct {
	service SelectedListExportPort
	logger  *slog.Logger
}

// NewSelectedListExportHandler binds the independent port and shared safe logger.
func NewSelectedListExportHandler(service SelectedListExportPort, logger *slog.Logger) *SelectedListExportHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &SelectedListExportHandler{service: service, logger: logger}
}

// List serves only the current actor's explicitly selected rows.
func (h *SelectedListExportHandler) List(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.ExportSelectedList)
}

// AdminList serves explicitly selected rows under the administrative grant.
func (h *SelectedListExportHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.AdminExportSelectedList)
}

// export binds identity, rejects ambiguous framing and maps sanitized service results.
func (h *SelectedListExportHandler) export(w http.ResponseWriter, r *http.Request, run func(context.Context, auth.CurrentUser, SelectedListExportInput) (ListExport, error)) {
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
	input, err := decodeSelectedListExport(r.Body)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	result, err := run(r.Context(), actor, input)
	if err != nil {
		h.fail(w, r, err)
		return
	}
	ok(w, result)
}

// fail preserves public error categories without exposing database parameters or raw errors.
func (h *SelectedListExportHandler) fail(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, ErrListExportLimit) {
		businessError(w, 200118, "Short link export limit exceeded")
		return
	}
	if !errors.Is(err, ErrInvalidInput) && !errors.Is(err, ErrPermissionDenied) {
		err = errors.New("short_link_selected_list_export_failed")
	}
	writeBusinessOrSystemError(w, r, h.logger, err)
}

// decodeSelectedListExport accepts exactly one ids property and one complete, bounded JSON object.
func decodeSelectedListExport(body io.Reader) (SelectedListExportInput, error) {
	raw, err := io.ReadAll(io.LimitReader(body, 16385))
	if err != nil || len(raw) > 16384 || !utf8.Valid(raw) {
		return SelectedListExportInput{}, ErrInvalidInput
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	token, err := d.Token()
	if err != nil || token != json.Delim('{') {
		return SelectedListExportInput{}, ErrInvalidInput
	}
	token, err = d.Token()
	if err != nil || token != "ids" {
		return SelectedListExportInput{}, ErrInvalidInput
	}
	var input SelectedListExportInput
	if d.Decode(&input.IDs) != nil || d.More() {
		return SelectedListExportInput{}, ErrInvalidInput
	}
	if _, err = d.Token(); err != nil || !errors.Is(d.Decode(new(any)), io.EOF) {
		return SelectedListExportInput{}, ErrInvalidInput
	}
	if _, err = selectedListExportIDs(input.IDs); err != nil {
		return SelectedListExportInput{}, err
	}
	return input, nil
}
