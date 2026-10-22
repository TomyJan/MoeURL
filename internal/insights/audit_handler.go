package insights

import (
	"github.com/TomyJan/MoeURL/internal/auth"
	"log/slog"
	"net/http"
)

type AuditHandler struct {
	service  AuditPort
	response *Handler
}

// NewAuditHandler reuses the private-read envelope without widening the statistics service port.
func NewAuditHandler(service AuditPort, logger *slog.Logger) *AuditHandler {
	return &AuditHandler{service, NewHandler(nil, logger)}
}

// List serves bounded audit metadata after strict wire parsing and live administrator authorization.
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	input, err := parseAuditQuery(r.URL.RawQuery)
	if err != nil {
		h.response.respond(w, r, nil, err)
		return
	}
	result, err := h.service.Audit(r.Context(), auth.UserFromContext(r.Context()), input)
	h.response.respond(w, r, result, err)
}
