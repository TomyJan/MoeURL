package insights

import (
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// GlobalVisitExportHandler serves only the independent site-wide export port.
type GlobalVisitExportHandler struct {
	service  GlobalVisitExportPort
	response *Handler
}

// NewGlobalVisitExportHandler reuses private response framing and redacted diagnostics.
func NewGlobalVisitExportHandler(service GlobalVisitExportPort, logger *slog.Logger) *GlobalVisitExportHandler {
	return &GlobalVisitExportHandler{service, NewHandler(nil, logger)}
}

// Export rejects link IDs, pagination and record filters before reading a global snapshot.
func (h *GlobalVisitExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	input, err := parseQuery(r.URL.RawQuery, false)
	if err != nil {
		h.response.respond(w, r, nil, err)
		return
	}
	result, err := h.service.ExportGlobalVisits(r.Context(), auth.UserFromContext(r.Context()), input.RangeInput)
	h.response.respond(w, r, result, err)
}
