package shortlink

import (
	"context"
	"log/slog"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/auth"
)

// ExportPort exposes authorized exports independently of ordinary short-link operations.
type ExportPort interface {
	ExportStatistics(context.Context, auth.CurrentUser, StatisticsInput) (StatisticsExport, error)
	AdminExportStatistics(context.Context, auth.CurrentUser, StatisticsInput) (StatisticsExport, error)
}

// ExportHandler serves JSON download descriptions through the existing statistics contract.
type ExportHandler struct {
	service ExportPort
	logger  *slog.Logger
}

// NewExportHandler constructs the independent export handler with the shared application logger.
func NewExportHandler(service ExportPort, logger *slog.Logger) *ExportHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &ExportHandler{service: service, logger: logger}
}

// Statistics returns a newly authorized export for a short link owned by the caller.
func (h *ExportHandler) Statistics(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.ExportStatistics)
}

// AdminStatistics returns a newly authorized export for an administratively visible short link.
func (h *ExportHandler) AdminStatistics(w http.ResponseWriter, r *http.Request) {
	h.export(w, r, h.service.AdminExportStatistics)
}

// export shares strict parameter parsing and error mapping between both export contexts.
func (h *ExportHandler) export(w http.ResponseWriter, r *http.Request, run func(context.Context, auth.CurrentUser, StatisticsInput) (StatisticsExport, error)) {
	input, err := statisticsInput(r.URL.RawQuery)
	if err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	result, err := run(r.Context(), auth.UserFromContext(r.Context()), input)
	if err != nil {
		writeBusinessOrSystemError(w, r, h.logger, err)
		return
	}
	ok(w, result)
}
