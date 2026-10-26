package insights

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"strings"
	"time"
	"unicode"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

const maxVisitExportBytes = 8 * 1024 * 1024

// ErrVisitExportLimit rejects the entire export when a row or byte budget is exceeded.
var ErrVisitExportLimit = errors.New("visit export limit exceeded")

// VisitExportInput selects one visible link and applied anonymous record filters.
type VisitExportInput struct {
	RangeInput
	ID, DeviceType, CountryCode string
}

// VisitExport describes a complete bounded CSV through the business envelope.
type VisitExport struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

// VisitExportPort separates record exports from paginated usage reads.
type VisitExportPort interface {
	ExportVisits(context.Context, auth.CurrentUser, VisitExportInput) (VisitExport, error)
	AdminExportVisits(context.Context, auth.CurrentUser, VisitExportInput) (VisitExport, error)
}

// ExportVisits exports anonymous records of a link currently owned by the actor.
func (s *Service) ExportVisits(ctx context.Context, user auth.CurrentUser, input VisitExportInput) (VisitExport, error) {
	return s.exportVisits(ctx, user, input, false)
}

// AdminExportVisits requires the complete administrative record-export permission intersection.
func (s *Service) AdminExportVisits(ctx context.Context, user auth.CurrentUser, input VisitExportInput) (VisitExport, error) {
	return s.exportVisits(ctx, user, input, true)
}

// exportVisits authorizes and generates the entire file inside one bounded database snapshot.
func (s *Service) exportVisits(ctx context.Context, user auth.CurrentUser, input VisitExportInput, admin bool) (VisitExport, error) {
	_, _, err := validateVisits(VisitInput{RangeInput: input.RangeInput, ID: input.ID, DeviceType: input.DeviceType, CountryCode: input.CountryCode})
	if err != nil {
		return VisitExport{}, err
	}
	required := []string{permission.ShortLinkExportVisits, permission.ShortLinkReadVisits, permission.ShortLinkReadOwn}
	if admin {
		required = []string{permission.ShortLinkExportVisits, permission.ShortLinkReadVisits, permission.AdminAccess, permission.ShortLinkReadAll}
	}
	var result VisitExport
	err = s.read(ctx, user, input.RangeInput, required, func(ctx context.Context, view snapshot) error {
		_, err := view.queries.GetInsightLink(ctx, sqlc.GetInsightLinkParams{ID: input.ID, Admin: admin, OwnerID: user.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkMissing
		}
		if err != nil {
			return err
		}
		rows, err := view.queries.ExportInsightVisits(ctx, sqlc.ExportInsightVisitsParams{ShortLinkID: input.ID, RangeStart: timestamp(view.dates.start), RangeEnd: timestamp(view.dates.end), DeviceType: input.DeviceType, CountryCode: input.CountryCode})
		if err != nil {
			return err
		}
		if len(rows) > 0 && rows[0].LimitExceeded {
			return ErrVisitExportLimit
		}
		result, err = visitExportCSV(ctx, input.ID, view.dates.response, rows)
		return err
	})
	if err != nil {
		return VisitExport{}, err
	}
	return result, nil
}

type visitExportBuffer struct{ buffer bytes.Buffer }

// Write retains at most the exact CSV byte budget, including escaping and the BOM.
func (b *visitExportBuffer) Write(data []byte) (int, error) {
	if len(data) > maxVisitExportBytes-b.buffer.Len() {
		return 0, ErrVisitExportLimit
	}
	return b.buffer.Write(data)
}

// visitExportCSV encodes only the fixed anonymous schema and discards failed partial files.
func visitExportCSV(ctx context.Context, id string, dates Range, rows []sqlc.ExportInsightVisitsRow) (VisitExport, error) {
	var output visitExportBuffer
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
		cells := []string{id, dates.StartDate, dates.EndDate, "UTC", row.ID, row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), row.ReferrerHost, row.DeviceType, row.BrowserFamily, row.OsFamily, row.CountryCode}
		for i, value := range cells {
			cells[i] = visitExportText(value)
		}
		if err := writer.Write(cells); err != nil {
			return VisitExport{}, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return VisitExport{}, err
	}
	return VisitExport{FileName: "moeurl-visits-" + id + "-" + dates.StartDate + "-" + dates.EndDate + ".csv", ContentType: "text/csv;charset=utf-8", Content: output.buffer.String()}, nil
}

// visitExportText neutralizes formula prefixes independently of standard CSV quoting.
func visitExportText(value string) string {
	trimmed := strings.TrimLeftFunc(value, unicode.IsSpace)
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || (len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0]))) {
		return "'" + value
	}
	return value
}
