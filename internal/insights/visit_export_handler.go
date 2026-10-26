package insights

import (
	"log/slog"
	"net/http"
	"net/url"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// VisitExportHandler serves the independent bounded record-export port.
type VisitExportHandler struct {
	service  VisitExportPort
	response *Handler
}

// NewVisitExportHandler reuses the private insight response and diagnostic policy.
func NewVisitExportHandler(service VisitExportPort, logger *slog.Logger) *VisitExportHandler {
	return &VisitExportHandler{service, NewHandler(nil, logger)}
}

// ExportVisits serves owner-scoped record exports.
func (h *VisitExportHandler) ExportVisits(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, false)
}

// AdminExportVisits serves the explicit administrator export scope.
func (h *VisitExportHandler) AdminExportVisits(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, true)
}

// export rejects all non-export parameters before invoking either business scope.
func (h *VisitExportHandler) export(w http.ResponseWriter, r *http.Request, admin bool) {
	input, err := parseVisitExportQuery(r.URL.RawQuery)
	if err != nil {
		h.response.respond(w, r, nil, err)
		return
	}
	var result VisitExport
	if admin {
		result, err = h.service.AdminExportVisits(r.Context(), auth.UserFromContext(r.Context()), input)
	} else {
		result, err = h.service.ExportVisits(r.Context(), auth.UserFromContext(r.Context()), input)
	}
	h.response.respond(w, r, result, err)
}

// parseVisitExportQuery accepts only nonempty, unique applied filters and a canonical link ID.
func parseVisitExportQuery(raw string) (VisitExportInput, error) {
	query, err := url.ParseQuery(raw)
	if err != nil {
		return VisitExportInput{}, ErrInvalidInput
	}
	for key, values := range query {
		switch key {
		case "id", "days", "startDate", "endDate", "deviceType", "countryCode":
		default:
			return VisitExportInput{}, ErrInvalidInput
		}
		if len(values) != 1 || values[0] == "" {
			return VisitExportInput{}, ErrInvalidInput
		}
	}
	input := VisitExportInput{RangeInput: RangeInput{Days: query.Get("days"), StartDate: query.Get("startDate"), EndDate: query.Get("endDate")}, ID: query.Get("id"), DeviceType: query.Get("deviceType"), CountryCode: query.Get("countryCode")}
	_, _, err = validateVisits(VisitInput{RangeInput: input.RangeInput, ID: input.ID, DeviceType: input.DeviceType, CountryCode: input.CountryCode})
	return input, err
}
