package shortlink

import (
	"context"
	"errors"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	shortLinkStatusActive = "active"
	maxSlugAttempts       = 8
	defaultPage           = 1
	defaultPageSize       = 20
	maxPageSize           = 100
)

type Service struct {
	queries     *sqlc.Queries
	permissions *permission.Service
}

// NewService creates a short link service backed by SQLC queries and permissions.
func NewService(pool *pgxpool.Pool, permissions *permission.Service) *Service {
	if permissions == nil {
		permissions = permission.NewService()
	}
	return &Service{
		queries:     sqlc.New(pool),
		permissions: permissions,
	}
}

// Create validates a target URL and creates an active short link for the caller.
func (s *Service) Create(ctx context.Context, user auth.CurrentUser, input CreateInput) (CreateResult, error) {
	if !s.permissions.Has(user.GroupKey, permission.ShortLinkCreate) || !s.permissions.Has(user.GroupKey, permission.DomainUseDefault) {
		return CreateResult{}, ErrPermissionDenied
	}
	if err := validateTargetURL(input.TargetURL); err != nil {
		return CreateResult{}, err
	}

	domain, err := s.queries.GetDefaultShortLinkDomain(ctx)
	if err != nil {
		return CreateResult{}, err
	}

	ownerID, err := uuid.Parse(user.ID)
	if err != nil {
		return CreateResult{}, err
	}

	for attempt := 0; attempt < maxSlugAttempts; attempt++ {
		slug, err := generateSlug()
		if err != nil {
			return CreateResult{}, err
		}
		if isReservedSlug(slug) {
			continue
		}

		created, err := s.queries.CreateShortLink(ctx, sqlc.CreateShortLinkParams{
			ID:        uuidToPgtype(uuid.New()),
			OwnerID:   uuidToPgtype(ownerID),
			DomainID:  domain.ID,
			Slug:      slug,
			TargetUrl: input.TargetURL,
			Status:    shortLinkStatusActive,
		})
		if isUniqueViolation(err) {
			continue
		}
		if err != nil {
			return CreateResult{}, err
		}

		return CreateResult{
			ShortLink: ShortLink{
				ID:        uuidFromPgtype(created.ID),
				URL:       buildShortLinkURL(domain.Host, created.Slug),
				Slug:      created.Slug,
				TargetURL: created.TargetUrl,
				Status:    created.Status,
			},
		}, nil
	}

	return CreateResult{}, ErrSlugConflict
}

// List returns a paginated view of short links owned by the caller.
func (s *Service) List(ctx context.Context, user auth.CurrentUser, input ListInput) (ListResult, error) {
	if !s.permissions.Has(user.GroupKey, permission.ShortLinkReadOwn) {
		return ListResult{}, ErrPermissionDenied
	}
	if input.Status != "" && !isAllowedStatus(input.Status) {
		return ListResult{}, ErrInvalidStatus
	}

	page, pageSize := normalizePagination(input)
	ownerID, err := uuid.Parse(user.ID)
	if err != nil {
		return ListResult{}, err
	}

	total, err := s.queries.CountShortLinksByOwner(ctx, sqlc.CountShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Status:  optionalFilterText(input.Status),
	})
	if err != nil {
		return ListResult{}, err
	}

	rows, err := s.queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Limit:   pageSize,
		Offset:  (page - 1) * pageSize,
		Status:  optionalFilterText(input.Status),
	})
	if err != nil {
		return ListResult{}, err
	}

	items := make([]ShortLink, 0, len(rows))
	for _, row := range rows {
		items = append(items, ShortLink{
			ID:        uuidFromPgtype(row.ID),
			URL:       buildShortLinkURL(row.DomainHost, row.Slug),
			Slug:      row.Slug,
			TargetURL: row.TargetUrl,
			Status:    row.Status,
			Stats:     statsFromRow(row.VisitCount, row.TodayVisitCount, row.LastVisitedAt),
		})
	}

	return ListResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

// Update changes the target URL or status of a short link owned by the caller.
func (s *Service) Update(ctx context.Context, user auth.CurrentUser, input UpdateInput) (CreateResult, error) {
	if !s.permissions.Has(user.GroupKey, permission.ShortLinkUpdateOwn) {
		return CreateResult{}, ErrPermissionDenied
	}
	if input.TargetURL != nil {
		if err := validateTargetURL(*input.TargetURL); err != nil {
			return CreateResult{}, err
		}
	}
	if input.Status != nil && !isAllowedStatus(*input.Status) {
		return CreateResult{}, ErrInvalidStatus
	}

	linkID, ownerID, err := parseLinkAndOwnerIDs(input.ID, user.ID)
	if err != nil {
		return CreateResult{}, err
	}

	updated, err := s.queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:        uuidToPgtype(linkID),
		OwnerID:   uuidToPgtype(ownerID),
		TargetUrl: optionalText(input.TargetURL),
		Status:    optionalText(input.Status),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return CreateResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return CreateResult{}, err
	}

	domain, err := s.queries.GetDefaultShortLinkDomain(ctx)
	if err != nil {
		return CreateResult{}, err
	}

	return CreateResult{
		ShortLink: ShortLink{
			ID:        uuidFromPgtype(updated.ID),
			URL:       buildShortLinkURL(domain.Host, updated.Slug),
			Slug:      updated.Slug,
			TargetURL: updated.TargetUrl,
			Status:    updated.Status,
		},
	}, nil
}

// Delete soft-deletes a short link owned by the caller.
func (s *Service) Delete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error {
	if !s.permissions.Has(user.GroupKey, permission.ShortLinkDeleteOwn) {
		return ErrPermissionDenied
	}

	linkID, ownerID, err := parseLinkAndOwnerIDs(input.ID, user.ID)
	if err != nil {
		return err
	}

	rows, err := s.queries.SoftDeleteOwnShortLink(ctx, sqlc.SoftDeleteOwnShortLinkParams{
		ID:      uuidToPgtype(linkID),
		OwnerID: uuidToPgtype(ownerID),
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrShortLinkMissing
	}
	return nil
}

// AdminList returns a paginated, filterable view of all short links.
func (s *Service) AdminList(ctx context.Context, user auth.CurrentUser, input ListInput) (AdminListResult, error) {
	if !s.hasAdminPermission(user, permission.ShortLinkReadAll) {
		return AdminListResult{}, ErrPermissionDenied
	}
	if input.Status != "" && !isAllowedStatus(input.Status) {
		return AdminListResult{}, ErrInvalidStatus
	}

	page, pageSize := normalizePagination(input)
	total, err := s.queries.CountAllShortLinks(ctx, sqlc.CountAllShortLinksParams{
		Status: optionalFilterText(input.Status),
		Query:  input.Query,
	})
	if err != nil {
		return AdminListResult{}, err
	}
	rows, err := s.queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{
		Limit:  pageSize,
		Offset: (page - 1) * pageSize,
		Status: optionalFilterText(input.Status),
		Query:  input.Query,
	})
	if err != nil {
		return AdminListResult{}, err
	}

	items := make([]AdminShortLink, 0, len(rows))
	for _, row := range rows {
		items = append(items, AdminShortLink{
			ID:        uuidFromPgtype(row.ID),
			URL:       buildShortLinkURL(row.DomainHost, row.Slug),
			Slug:      row.Slug,
			TargetURL: row.TargetUrl,
			Status:    row.Status,
			Stats:     statsFromRow(row.VisitCount, row.TodayVisitCount, row.LastVisitedAt),
			Owner: OwnerSummary{
				ID:       uuidFromPgtype(row.OwnerID),
				Username: row.OwnerUsername,
				Nickname: row.OwnerNickname,
			},
		})
	}

	return AdminListResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

// AdminUpdate changes the target URL or status of any short link.
func (s *Service) AdminUpdate(ctx context.Context, user auth.CurrentUser, input UpdateInput) (CreateResult, error) {
	if !s.hasAdminPermission(user, permission.ShortLinkUpdateAll) {
		return CreateResult{}, ErrPermissionDenied
	}
	if input.TargetURL != nil {
		if err := validateTargetURL(*input.TargetURL); err != nil {
			return CreateResult{}, err
		}
	}
	if input.Status != nil && !isAllowedStatus(*input.Status) {
		return CreateResult{}, ErrInvalidStatus
	}

	linkID, err := uuid.Parse(input.ID)
	if err != nil {
		return CreateResult{}, err
	}
	updated, err := s.queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:        uuidToPgtype(linkID),
		TargetUrl: optionalText(input.TargetURL),
		Status:    optionalText(input.Status),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return CreateResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return CreateResult{}, err
	}

	domain, err := s.queries.GetDefaultShortLinkDomain(ctx)
	if err != nil {
		return CreateResult{}, err
	}

	return CreateResult{
		ShortLink: ShortLink{
			ID:        uuidFromPgtype(updated.ID),
			URL:       buildShortLinkURL(domain.Host, updated.Slug),
			Slug:      updated.Slug,
			TargetURL: updated.TargetUrl,
			Status:    updated.Status,
		},
	}, nil
}

// AdminDelete soft-deletes any short link.
func (s *Service) AdminDelete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error {
	if !s.hasAdminPermission(user, permission.ShortLinkDeleteAll) {
		return ErrPermissionDenied
	}
	linkID, err := uuid.Parse(input.ID)
	if err != nil {
		return err
	}
	rows, err := s.queries.SoftDeleteAnyShortLink(ctx, uuidToPgtype(linkID))
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrShortLinkMissing
	}
	return nil
}

// hasAdminPermission checks both administrative access and the requested permission.
func (s *Service) hasAdminPermission(user auth.CurrentUser, required string) bool {
	return s.permissions.Has(user.GroupKey, permission.AdminAccess) && s.permissions.Has(user.GroupKey, required)
}

// normalizePagination applies default and maximum bounds to pagination input.
func normalizePagination(input ListInput) (int32, int32) {
	page := input.Page
	if page < 1 {
		page = defaultPage
	}
	pageSize := input.PageSize
	if pageSize < 1 {
		pageSize = defaultPageSize
	}
	if pageSize > maxPageSize {
		pageSize = maxPageSize
	}
	return page, pageSize
}

// parseLinkAndOwnerIDs parses short link and owner identifiers.
func parseLinkAndOwnerIDs(linkID string, ownerID string) (uuid.UUID, uuid.UUID, error) {
	parsedLinkID, err := uuid.Parse(linkID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	parsedOwnerID, err := uuid.Parse(ownerID)
	if err != nil {
		return uuid.Nil, uuid.Nil, err
	}
	return parsedLinkID, parsedOwnerID, nil
}

// optionalText converts an optional string to a nullable PostgreSQL text value.
func optionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

// optionalFilterText converts a non-empty filter to a nullable PostgreSQL text value.
func optionalFilterText(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}

// statsFromRow builds API statistics from aggregated query fields.
func statsFromRow(visitCount int64, todayVisitCount int64, lastVisitedAt pgtype.Timestamptz) *ShortLinkStats {
	stats := &ShortLinkStats{
		VisitCount:      visitCount,
		TodayVisitCount: todayVisitCount,
	}
	if lastVisitedAt.Valid {
		stats.LastVisitedAt = &lastVisitedAt.Time
	}
	return stats
}

// isAllowedStatus reports whether a short link status can be persisted.
func isAllowedStatus(value string) bool {
	return value == "active" || value == "disabled"
}

// uuidToPgtype converts a UUID to its PostgreSQL representation.
func uuidToPgtype(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}

// uuidFromPgtype converts a valid PostgreSQL UUID to its string representation.
func uuidFromPgtype(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return uuid.UUID(value.Bytes).String()
}

// buildShortLinkURL joins a configured host and slug into a public short link URL.
func buildShortLinkURL(host string, slug string) string {
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return strings.TrimRight(host, "/") + "/" + slug
	}
	return "https://" + strings.TrimRight(host, "/") + "/" + slug
}

// isUniqueViolation reports whether an error is a PostgreSQL unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
