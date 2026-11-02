package shortlink

import (
	"context"
	"errors"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// AdminTagCatalogPort keeps global reads separate from the personal directory and write ports.
type AdminTagCatalogPort interface {
	ListAdminTags(context.Context, auth.CurrentUser, TagCatalogInput) (TagCatalogResult, error)
}

// AdminTagCatalogHandler serves global tag searches with safe failure responses.
type AdminTagCatalogHandler struct {
	service AdminTagCatalogPort
	logger  *slog.Logger
}

// NewAdminTagCatalogHandler uses the application logger or the standard default.
func NewAdminTagCatalogHandler(service AdminTagCatalogPort, logger *slog.Logger) *AdminTagCatalogHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &AdminTagCatalogHandler{service: service, logger: logger}
}

// List rejects ambiguous queries before reading the currently authorized global directory.
func (h *AdminTagCatalogHandler) List(w http.ResponseWriter, r *http.Request) {
	query, valid := parseTagCatalogQuery(r.URL.RawQuery)
	if !valid {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := h.service.ListAdminTags(r.Context(), auth.UserFromContext(r.Context()), TagCatalogInput{Query: query})
	if err != nil {
		if !errors.Is(err, ErrInvalidInput) && !errors.Is(err, ErrPermissionDenied) {
			err = errors.New("admin_short_link_tag_catalog_failed")
		}
		writeBusinessOrSystemError(w, r, h.logger, err)
		return
	}
	ok(w, result)
}
