package insights

import (
	"log/slog"
	"net/http"
	"net/url"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// AuditExportHandler serves bounded audit exports independently of pagination.
type AuditExportHandler struct {
	service  AuditExportPort
	response *Handler
}

// NewAuditExportHandler applies the existing private response and safe diagnostic policy.
func NewAuditExportHandler(service AuditExportPort, logger *slog.Logger) *AuditExportHandler {
	return &AuditExportHandler{service, NewHandler(nil, logger)}
}

// Export rejects unsupported wire parameters before invoking the export port.
func (h *AuditExportHandler) Export(w http.ResponseWriter, r *http.Request) {
	input, err := parseAuditExportQuery(r.URL.RawQuery)
	if err != nil {
		h.response.respond(w, r, nil, err)
		return
	}
	result, err := h.service.ExportAudit(r.Context(), auth.UserFromContext(r.Context()), input)
	h.response.respond(w, r, result, err)
}

// parseAuditExportQuery accepts only unique nonempty dates and applied audit filters.
func parseAuditExportQuery(raw string) (AuditExportInput, error) {
	query, err := url.ParseQuery(raw)
	if err != nil {
		return AuditExportInput{}, ErrInvalidInput
	}
	for key, values := range query {
		switch key {
		case "days", "startDate", "endDate", "actorId", "resourceType", "action":
		default:
			return AuditExportInput{}, ErrInvalidInput
		}
		if len(values) != 1 || values[0] == "" {
			return AuditExportInput{}, ErrInvalidInput
		}
	}
	input := AuditExportInput{RangeInput: RangeInput{query.Get("days"), query.Get("startDate"), query.Get("endDate")}, ActorID: query.Get("actorId"), ResourceType: query.Get("resourceType"), Action: query.Get("action")}
	_, _, err = validateAudit(AuditInput{RangeInput: input.RangeInput, ActorID: input.ActorID, ResourceType: input.ResourceType, Action: input.Action})
	return input, err
}
