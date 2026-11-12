package insights

import (
	"context"
	"encoding/csv"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
)

// GlobalVisitExportPort keeps site-wide exports separate from link-scoped grants and filters.
type GlobalVisitExportPort interface {
	ExportGlobalVisits(context.Context, auth.CurrentUser, RangeInput) (VisitExport, error)
}

// ExportGlobalVisits reads all successful anonymous events in one authorized, bounded snapshot.
func (s *Service) ExportGlobalVisits(ctx context.Context, actor auth.CurrentUser, input RangeInput) (VisitExport, error) {
	var result VisitExport
	err := s.read(ctx, actor, input, []string{permission.AdminAccess, permission.StatisticsReadAll, permission.StatisticsExportVisits, permission.ShortLinkReadAll, permission.ShortLinkReadVisits}, func(ctx context.Context, view snapshot) error {
		rows, err := view.queries.ExportGlobalInsightVisits(ctx, sqlc.ExportGlobalInsightVisitsParams{RangeStart: timestamp(view.dates.start), RangeEnd: timestamp(view.dates.end)})
		if err != nil {
			return err
		}
		if len(rows) > 0 && rows[0].LimitExceeded {
			return ErrVisitExportLimit
		}
		result, err = globalVisitExportCSV(ctx, view.dates.response, rows)
		return err
	})
	if err != nil {
		return VisitExport{}, err
	}
	return result, nil
}

// globalVisitExportCSV preserves each event's real link ID and discards any partial file on failure.
func globalVisitExportCSV(ctx context.Context, dates Range, rows []sqlc.ExportGlobalInsightVisitsRow) (VisitExport, error) {
	var output csvExportBuffer
	_, _ = output.Write([]byte("\ufeff"))
	writer := csv.NewWriter(&output)
	writer.UseCRLF = true
	_ = writer.Write([]string{"short_link_id", "start_date", "end_date", "time_zone", "event_id", "occurred_at", "referrer_host", "device_type", "browser_family", "os_family", "country_code"})
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return VisitExport{}, err
		}
		if row.ID == "" {
			continue
		}
		cells := []string{row.ShortLinkID, dates.StartDate, dates.EndDate, "UTC", row.ID, row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), row.ReferrerHost, row.DeviceType, row.BrowserFamily, row.OsFamily, row.CountryCode}
		for i, value := range cells {
			cells[i] = csvExportText(value)
		}
		if err := writer.Write(cells); err != nil {
			return VisitExport{}, ErrVisitExportLimit
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return VisitExport{}, ErrVisitExportLimit
	}
	return VisitExport{FileName: "moeurl-site-visits-" + dates.StartDate + "-" + dates.EndDate + ".csv", ContentType: "text/csv;charset=utf-8", Content: output.buffer.String()}, nil
}
