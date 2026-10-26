package insights

import (
	"context"
	"encoding/csv"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
)

// ErrAuditExportLimit rejects an export exceeding either complete-file budget.
var ErrAuditExportLimit = errors.New("audit export limit exceeded")

// AuditExportInput selects applied audit filters without pagination.
type AuditExportInput struct {
	RangeInput
	ActorID, ResourceType, Action string
}

// AuditExport contains a complete bounded UTF-8 CSV in the business envelope.
type AuditExport struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

// AuditExportPort keeps exports independent of paginated audit consumers.
type AuditExportPort interface {
	ExportAudit(context.Context, auth.CurrentUser, AuditExportInput) (AuditExport, error)
}

// ExportAudit authorizes and encodes applied audit filters in one read-only snapshot.
func (s *Service) ExportAudit(ctx context.Context, actor auth.CurrentUser, input AuditExportInput) (AuditExport, error) {
	_, _, err := validateAudit(AuditInput{RangeInput: input.RangeInput, ActorID: input.ActorID, ResourceType: input.ResourceType, Action: input.Action})
	if err != nil {
		return AuditExport{}, err
	}
	var result AuditExport
	err = s.read(ctx, actor, input.RangeInput, []string{permission.AdminAccess, permission.AuditRead, permission.AuditExport}, func(ctx context.Context, view snapshot) error {
		rows, err := view.queries.ExportAuditLogs(ctx, sqlc.ExportAuditLogsParams{StartAt: timestamp(view.dates.start), EndAt: timestamp(view.dates.end), RetentionCutoff: timestamp(view.now.AddDate(0, 0, -180)), ActorID: input.ActorID, ResourceType: input.ResourceType, Action: input.Action})
		if err != nil {
			return err
		}
		if len(rows) > 0 && rows[0].LimitExceeded {
			return ErrAuditExportLimit
		}
		result, err = auditExportCSV(ctx, view.dates.response, rows)
		return err
	})
	if err != nil {
		return AuditExport{}, err
	}
	return result, nil
}

// auditExportCSV exposes only the fixed audit schema and discards any partial file on failure.
func auditExportCSV(ctx context.Context, dates Range, rows []sqlc.ExportAuditLogsRow) (AuditExport, error) {
	var output csvExportBuffer
	_, _ = output.Write([]byte("\ufeff"))
	writer := csv.NewWriter(&output)
	writer.UseCRLF = true
	_ = writer.Write([]string{"start_date", "end_date", "time_zone", "audit_id", "occurred_at", "actor_id", "actor_username", "resource_type", "resource_id", "action", "changed_fields"})
	for _, row := range rows {
		if err := ctx.Err(); err != nil {
			return AuditExport{}, err
		}
		if row.ID == "" {
			continue
		}
		cells := []string{dates.StartDate, dates.EndDate, "UTC", row.ID, row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), row.ActorID, row.ActorUsername, row.ResourceType, row.ResourceID, row.Action, row.ChangedFields}
		for i, value := range cells {
			cells[i] = csvExportText(value)
		}
		if err := writer.Write(cells); err != nil {
			return AuditExport{}, ErrAuditExportLimit
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return AuditExport{}, ErrAuditExportLimit
	}
	return AuditExport{FileName: "moeurl-audit-" + dates.StartDate + "-" + dates.EndDate + ".csv", ContentType: "text/csv;charset=utf-8", Content: output.buffer.String()}, nil
}
