package insights

import (
	"context"
	"errors"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

// Visits returns anonymous records only for a currently visible link owned by the caller.
func (s *Service) Visits(ctx context.Context, user auth.CurrentUser, input VisitInput) (VisitResult, error) {
	return s.visits(ctx, user, input, false)
}

// AdminVisits requires both administrative access and explicit all-link and visit capabilities.
func (s *Service) AdminVisits(ctx context.Context, user auth.CurrentUser, input VisitInput) (VisitResult, error) {
	return s.visits(ctx, user, input, true)
}

// visits enforces current visibility and reads a stable page plus one continuation marker.
func (s *Service) visits(ctx context.Context, user auth.CurrentUser, input VisitInput, admin bool) (VisitResult, error) {
	input, cursor, err := validateVisits(input)
	if err != nil {
		return VisitResult{}, err
	}
	required := []string{permission.ShortLinkReadVisits, permission.ShortLinkReadOwn}
	if admin {
		required = []string{permission.ShortLinkReadVisits, permission.AdminAccess, permission.ShortLinkReadAll}
	}
	result := VisitResult{Items: []VisitRecord{}, PageSize: input.PageSize}
	err = s.read(ctx, user, input.RangeInput, required, func(ctx context.Context, view snapshot) error {
		if input.Cursor != "" && (cursor.CreatedAt.Before(view.dates.start) || !cursor.CreatedAt.Before(view.dates.end)) {
			return ErrInvalidInput
		}
		_, err := view.queries.GetInsightLink(ctx, sqlc.GetInsightLinkParams{ID: input.ID, Admin: admin, OwnerID: user.ID})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrLinkMissing
		}
		if err != nil {
			return err
		}
		rows, err := view.queries.ListInsightVisits(ctx, sqlc.ListInsightVisitsParams{ShortLinkID: input.ID, RangeStart: timestamp(view.dates.start), RangeEnd: timestamp(view.dates.end), DeviceType: input.DeviceType, CountryCode: input.CountryCode, HasCursor: input.Cursor != "", CursorTime: timestamp(cursor.CreatedAt), CursorID: cursor.ID, RowLimit: input.PageSize + 1})
		if err != nil {
			return err
		}
		result.Range = view.dates.response
		result.HasMore = len(rows) > int(input.PageSize)
		if result.HasMore {
			rows = rows[:input.PageSize]
		}
		for _, row := range rows {
			result.Items = append(result.Items, VisitRecord{row.ID, row.CreatedAt.Time.UTC(), nullableDimension(row.ReferrerHost), nullableDimension(row.DeviceType), nullableDimension(row.BrowserFamily), nullableDimension(row.OsFamily), nullableDimension(row.CountryCode)})
		}
		if result.HasMore {
			last := rows[len(rows)-1]
			result.NextCursor = encodeCursor(last.CreatedAt.Time, last.ID)
		}
		return nil
	})
	if err != nil {
		return VisitResult{}, err
	}
	return result, nil
}
