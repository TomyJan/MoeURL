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

// TagCatalogPort isolates the read-only directory from management and export ports.
type TagCatalogPort interface {
	ListTags(context.Context, auth.CurrentUser, TagCatalogInput) (TagCatalogResult, error)
}

// TagCatalogHandler serves personal tag searches without exposing infrastructure details.
type TagCatalogHandler struct {
	service TagCatalogPort
	logger  *slog.Logger
}

// NewTagCatalogHandler uses the application logger or the standard default.
func NewTagCatalogHandler(service TagCatalogPort, logger *slog.Logger) *TagCatalogHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &TagCatalogHandler{service: service, logger: logger}
}

// List rejects ambiguous query parameters before reading the current actor's directory.
func (h *TagCatalogHandler) List(w http.ResponseWriter, r *http.Request) {
	query, valid := parseTagCatalogQuery(r.URL.RawQuery)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.ListTags(r.Context(), auth.UserFromContext(r.Context()), TagCatalogInput{Query: query})
	if err != nil {
		if !errors.Is(err, ErrInvalidInput) && !errors.Is(err, ErrPermissionDenied) {
			err = errors.New("short_link_tag_catalog_failed")
		}
		writeBusinessOrSystemError(w, r, h.logger, err)
		return
	}
	ok(w, result)
}

// parseTagCatalogQuery accepts only one optional q with an explicit equals sign.
func parseTagCatalogQuery(raw string) (string, bool) {
	values, err := url.ParseQuery(raw)
	if err != nil {
		return "", false
	}
	if raw != "" {
		for _, part := range strings.Split(raw, "&") {
			if !strings.Contains(part, "=") {
				return "", false
			}
		}
	}
	for key, items := range values {
		if key != "q" || len(items) != 1 {
			return "", false
		}
	}
	return values.Get("q"), true
}
