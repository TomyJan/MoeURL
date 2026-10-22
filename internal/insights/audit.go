package insights

import (
	"context"
	"net/url"
	"strconv"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
)

// Audit reads one authorized snapshot with a rolling retention boundary and lossless bigint keyset.
func (s *Service) Audit(ctx context.Context, actor auth.CurrentUser, input AuditInput) (AuditResult, error) {
	input, cursor, err := validateAudit(input)
	if err != nil {
		return AuditResult{}, err
	}
	var result AuditResult
	err = s.read(ctx, actor, input.RangeInput, []string{permission.AdminAccess, permission.AuditRead}, func(ctx context.Context, snap snapshot) error {
		cursorID, _ := strconv.ParseInt(cursor.ID, 10, 64)
		rows, err := snap.queries.ListAuditLogs(ctx, sqlc.ListAuditLogsParams{
			StartAt: timestamp(snap.dates.start), EndAt: timestamp(snap.dates.end), RetentionCutoff: timestamp(snap.now.AddDate(0, 0, -180)),
			ActorID: input.ActorID, ResourceType: input.ResourceType, Action: input.Action, HasCursor: input.Cursor != "",
			CursorTime: timestamp(cursor.CreatedAt), CursorID: cursorID, PageLimit: input.PageSize + 1,
		})
		if err != nil {
			return err
		}
		result = AuditResult{Items: make([]AuditItem, 0, input.PageSize), Range: snap.dates.response, PageSize: input.PageSize, RetentionDays: 180, HasMore: len(rows) > int(input.PageSize)}
		if result.HasMore {
			rows = rows[:input.PageSize]
		}
		for _, row := range rows {
			var actorID *string
			if row.ActorID.Valid {
				id := uuid.UUID(row.ActorID.Bytes).String()
				actorID = &id
			}
			result.Items = append(result.Items, AuditItem{ID: strconv.FormatInt(row.ID, 10), ActorID: actorID, ActorUsername: nullableDimension(row.ActorUsername), ResourceType: row.ResourceType, ResourceID: row.ResourceID, Action: row.Action, ChangedFields: row.ChangedFields, OccurredAt: row.CreatedAt.Time.UTC()})
		}
		if result.HasMore {
			last := result.Items[len(result.Items)-1]
			result.NextCursor = encodeCursor(last.OccurredAt, last.ID)
		}
		return nil
	})
	return result, err
}

// validAuditID rejects signs, padding, overflow and nonpositive IDs at the cursor boundary.
func validAuditID(raw string) bool {
	id, err := strconv.ParseInt(raw, 10, 64)
	return err == nil && id > 0 && strconv.FormatInt(id, 10) == raw
}

// validateAudit bounds every public filter before the database is touched.
func validateAudit(input AuditInput) (AuditInput, visitCursor, error) {
	if validateRangeSyntax(input.RangeInput) != nil || input.PageSize < 0 || input.PageSize > 100 || (input.ActorID != "" && !validUUID(input.ActorID)) {
		return input, visitCursor{}, ErrInvalidInput
	}
	if input.PageSize == 0 {
		input.PageSize = 25
	}
	switch input.ResourceType {
	case "", "short_link", "user", "user_group", "domain", "system_setting", "oidc_provider":
	default:
		return input, visitCursor{}, ErrInvalidInput
	}
	switch input.Action {
	case "", "create", "update", "enable", "disable", "delete", "credential_change", "permissions_change", "assignment_change", "settings_change":
	default:
		return input, visitCursor{}, ErrInvalidInput
	}
	cursor, err := decodeKeysetCursor(input.Cursor, validAuditID)
	return input, cursor, err
}

// parseAuditQuery rejects empty, duplicate and unsupported wire parameters without silently normalizing them.
func parseAuditQuery(raw string) (AuditInput, error) {
	query, err := url.ParseQuery(raw)
	if err != nil {
		return AuditInput{}, ErrInvalidInput
	}
	for key, values := range query {
		switch key {
		case "days", "startDate", "endDate", "actorId", "resourceType", "action", "cursor", "pageSize":
		default:
			return AuditInput{}, ErrInvalidInput
		}
		if len(values) != 1 || values[0] == "" {
			return AuditInput{}, ErrInvalidInput
		}
	}
	input := AuditInput{RangeInput: RangeInput{query.Get("days"), query.Get("startDate"), query.Get("endDate")}, ActorID: query.Get("actorId"), ResourceType: query.Get("resourceType"), Action: query.Get("action"), Cursor: query.Get("cursor")}
	if rawSize := query.Get("pageSize"); rawSize != "" {
		size, err := strconv.ParseInt(rawSize, 10, 32)
		if err != nil || size < 1 || size > 100 || strconv.FormatInt(size, 10) != rawSize {
			return AuditInput{}, ErrInvalidInput
		}
		input.PageSize = int32(size)
	}
	return input, nil
}
