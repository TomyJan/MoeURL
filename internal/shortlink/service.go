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

func NewService(pool *pgxpool.Pool, permissions *permission.Service) *Service {
	if permissions == nil {
		permissions = permission.NewService()
	}
	return &Service{
		queries:     sqlc.New(pool),
		permissions: permissions,
	}
}

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

func (s *Service) List(ctx context.Context, user auth.CurrentUser, input ListInput) (ListResult, error) {
	if !s.permissions.Has(user.GroupKey, permission.ShortLinkReadOwn) {
		return ListResult{}, ErrPermissionDenied
	}

	page, pageSize := normalizePagination(input)
	ownerID, err := uuid.Parse(user.ID)
	if err != nil {
		return ListResult{}, err
	}

	total, err := s.queries.CountShortLinksByOwner(ctx, uuidToPgtype(ownerID))
	if err != nil {
		return ListResult{}, err
	}

	rows, err := s.queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Limit:   pageSize,
		Offset:  (page - 1) * pageSize,
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
		})
	}

	return ListResult{
		Items:    items,
		Page:     page,
		PageSize: pageSize,
		Total:    total,
	}, nil
}

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

func (s *Service) AdminList(ctx context.Context, user auth.CurrentUser, input ListInput) (AdminListResult, error) {
	if !s.hasAdminPermission(user, permission.ShortLinkReadAll) {
		return AdminListResult{}, ErrPermissionDenied
	}

	page, pageSize := normalizePagination(input)
	total, err := s.queries.CountAllShortLinks(ctx)
	if err != nil {
		return AdminListResult{}, err
	}
	rows, err := s.queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{
		Limit:  pageSize,
		Offset: (page - 1) * pageSize,
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

func (s *Service) hasAdminPermission(user auth.CurrentUser, required string) bool {
	return s.permissions.Has(user.GroupKey, permission.AdminAccess) && s.permissions.Has(user.GroupKey, required)
}

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

func optionalText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

func isAllowedStatus(value string) bool {
	return value == "active" || value == "disabled"
}

func uuidToPgtype(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}

func uuidFromPgtype(value pgtype.UUID) string {
	if !value.Valid {
		return ""
	}
	return uuid.UUID(value.Bytes).String()
}

func buildShortLinkURL(host string, slug string) string {
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return strings.TrimRight(host, "/") + "/" + slug
	}
	return "https://" + strings.TrimRight(host, "/") + "/" + slug
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
