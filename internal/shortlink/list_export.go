package shortlink

import (
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"strconv"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
)

const maxListExportBytes = 8 * 1024 * 1024

// ErrListExportLimit rejects the entire file when any export bound is exceeded.
var ErrListExportLimit = errors.New("short link list export limit exceeded")

// ListExportInput reuses applied list filters without accepting client-owned scope or limits.
type ListExportInput struct{ Status, Query, Tag string }

// ListExport describes a bounded CSV download through the normal JSON envelope.
type ListExport struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

type listExportReader interface {
	ExportShortLinkList(context.Context, sqlc.ExportShortLinkListParams) ([]sqlc.ExportShortLinkListRow, error)
}

// ExportList exports only the current actor's authorized, non-deleted links.
func (s *Service) ExportList(ctx context.Context, user auth.CurrentUser, input ListExportInput) (ListExport, error) {
	return s.exportList(ctx, user, input, false)
}

// AdminExportList exports links under the full administrative permission intersection.
func (s *Service) AdminExportList(ctx context.Context, user auth.CurrentUser, input ListExportInput) (ListExport, error) {
	return s.exportList(ctx, user, input, true)
}

// exportList bounds the whole operation and relies on a single SELECT snapshot for its final authorization.
func (s *Service) exportList(ctx context.Context, user auth.CurrentUser, input ListExportInput, admin bool) (ListExport, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	required := []string{permission.ShortLinkExport, permission.ShortLinkReadOwn}
	if admin {
		required = []string{permission.ShortLinkExport, permission.AdminAccess, permission.ShortLinkReadAll}
	}
	if _, err := s.authorize(ctx, user, required...); err != nil {
		return ListExport{}, err
	}
	if input.Status != "" && !isAllowedStatus(input.Status) {
		return ListExport{}, ErrInvalidStatus
	}
	query, tag, err := normalizeListFilters(ListInput{Query: input.Query, Tag: input.Tag})
	if err != nil {
		return ListExport{}, err
	}
	actorID, err := uuid.Parse(user.ID)
	if err != nil {
		return ListExport{}, ErrPermissionDenied
	}
	rows, err := s.listExports.ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{ActorID: uuidToPgtype(actorID), IsAdmin: admin, Status: input.Status, Query: query, Tag: tag})
	if err != nil {
		return ListExport{}, err
	}
	if len(rows) == 0 || !rows[0].Allowed {
		return ListExport{}, ErrPermissionDenied
	}
	if rows[0].LimitExceeded {
		return ListExport{}, ErrListExportLimit
	}
	return listExportCSV(rows, admin)
}

// listExportBuffer enforces the byte cap while the CSV writer emits escaped cells.
type listExportBuffer struct{ buffer bytes.Buffer }

// Write never retains bytes beyond the server's maximum file size.
func (b *listExportBuffer) Write(data []byte) (int, error) {
	if len(data) > maxListExportBytes-b.buffer.Len() {
		return 0, ErrListExportLimit
	}
	return b.buffer.Write(data)
}

// listExportCSV emits only the explicit management schema and never returns a partial file.
func listExportCSV(rows []sqlc.ExportShortLinkListRow, admin bool) (ListExport, error) {
	var output listExportBuffer
	_, _ = output.Write([]byte("\ufeff"))
	writer := csv.NewWriter(&output)
	writer.UseCRLF = true
	_ = writer.Write([]string{"id", "short_url", "slug", "target_url", "title", "tags", "status", "redirect_mode", "intermediate_delay_seconds", "expires_at", "password_enabled", "max_visits", "visits_used", "created_at", "updated_at", "owner_id", "owner_username"})
	for _, row := range rows {
		if row.ID == "" {
			continue
		}
		tags, _ := json.Marshal(metadataTags(row.Tags)) // []string is always JSON encodable.
		expires, maximum := "", ""
		if row.ExpiresAt.Valid {
			expires = row.ExpiresAt.Time.UTC().Format(time.RFC3339Nano)
		}
		if row.MaxVisits > 0 {
			maximum = strconv.FormatInt(row.MaxVisits, 10)
		}
		cells := []string{row.ID, buildShortLinkURL(row.DomainHost, row.Slug), row.Slug, row.TargetUrl, row.Title, string(tags), row.Status, row.RedirectMode, strconv.FormatInt(int64(row.IntermediateDelaySeconds), 10), expires, strconv.FormatBool(row.PasswordEnabled), maximum, strconv.FormatInt(row.VisitsUsed, 10), row.CreatedAt.Time.UTC().Format(time.RFC3339Nano), row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano), row.OwnerID, row.OwnerUsername}
		for index := range cells {
			cells[index] = csvText(cells[index])
		}
		if err := writer.Write(cells); err != nil {
			return ListExport{}, err
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return ListExport{}, err
	}
	name := "moeurl-links-own.csv"
	if admin {
		name = "moeurl-links-all.csv"
	}
	return ListExport{FileName: name, ContentType: "text/csv;charset=utf-8", Content: output.buffer.String()}, nil
}
