package shortlink

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// ListExportPort keeps list exports independent of the ordinary and statistics ports.
type ListExportPort interface {
	ExportList(context.Context, auth.CurrentUser, ListExportInput) (ListExport, error)
	AdminExportList(context.Context, auth.CurrentUser, ListExportInput) (ListExport, error)
}

// ListExportHandler serves bounded downloads through authenticated JSON routes.
type ListExportHandler struct {
	service ListExportPort
	logger  *slog.Logger
}

// NewListExportHandler constructs an independent list-export handler.
func NewListExportHandler(service ListExportPort, logger *slog.Logger) *ListExportHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &ListExportHandler{service: service, logger: logger}
}

// List exports the authenticated actor's filtered list.
func (h *ListExportHandler) List(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.ExportList)
}

// AdminList exports the administratively visible filtered list.
func (h *ListExportHandler) AdminList(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.AdminExportList)
}

// export parses only the list filters and keeps infrastructure details out of logs and responses.
func (h *ListExportHandler) export(w http.ResponseWriter, r *http.Request, run func(context.Context, auth.CurrentUser, ListExportInput) (ListExport, error)) {
	input, err := listExportInput(r.URL.RawQuery)
	if err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := run(r.Context(), auth.UserFromContext(r.Context()), input)
	if errors.Is(err, ErrListExportLimit) {
		businessError(w, 200118, "Short link export limit exceeded")
		return
	}
	if err != nil {
		if !errors.Is(err, ErrInvalidInput) && !errors.Is(err, ErrInvalidStatus) && !errors.Is(err, ErrPermissionDenied) {
			err = errors.New("short_link_list_export_failed")
		}
		writeBusinessOrSystemError(w, r, h.logger, err)
		return
	}
	ok(w, result)
}

// listExportInput rejects ambiguous and unsupported parameters before any service call.
func listExportInput(raw string) (ListExportInput, error) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return ListExportInput{}, ErrInvalidInput
	}
	if raw != "" {
		for _, part := range strings.Split(raw, "&") {
			if !strings.Contains(part, "=") {
				return ListExportInput{}, ErrInvalidInput
			}
		}
	}
	for key, items := range values {
		if (key != "status" && key != "q" && key != "tag") || len(items) != 1 {
			return ListExportInput{}, ErrInvalidInput
		}
	}
	return ListExportInput{Status: values.Get("status"), Query: values.Get("q"), Tag: values.Get("tag")}, nil
}
