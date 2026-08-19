package shortlink

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

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
	shortLinkStatusActive    = "active"
	maxSlugAttempts          = 8
	defaultPage              = 1
	defaultPageSize          = 20
	maxPageSize              = 100
	defaultIntermediateDelay = int16(5)
	minIntermediateDelay     = int16(3)
	maxIntermediateDelay     = int16(10)
	expirationModeKeep       = "keep"
	passwordModeKeep         = "keep"
	minPasswordLength        = 8
	maxPasswordLength        = 128
)

type Service struct {
	queries     *sqlc.Queries
	permissions permission.Resolver
}

// NewService creates a short link service backed by SQLC queries and permissions.
func NewService(pool *pgxpool.Pool, permissions permission.Resolver) *Service {
	return NewServiceWithLogger(pool, permissions, slog.Default())
}

// NewServiceWithLogger creates a short link service with an injectable logger.
func NewServiceWithLogger(pool *pgxpool.Pool, permissions permission.Resolver, logger *slog.Logger) *Service {
	if logger == nil {
		logger = slog.Default()
	}
	if permissions == nil {
		logger.Error("short_link_permission_resolver_required")
		permissions = missingPermissionResolver{}
	}
	return &Service{
		queries:     sqlc.New(pool),
		permissions: permissions,
	}
}

// Create validates a target URL and creates an active short link for the caller.
func (s *Service) Create(ctx context.Context, user auth.CurrentUser, input CreateInput) (CreateResult, error) {
	permissions, err := s.authorize(ctx, user, permission.ShortLinkCreate, permission.DomainUseDefault)
	if err != nil {
		return CreateResult{}, err
	}
	if err := validateTargetURL(input.TargetURL); err != nil {
		return CreateResult{}, err
	}
	accessConfig, err := s.createAccessConfig(ctx, permissions, input)
	if err != nil {
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
			ID:                       uuidToPgtype(uuid.New()),
			OwnerID:                  uuidToPgtype(ownerID),
			DomainID:                 domain.ID,
			Slug:                     slug,
			TargetUrl:                input.TargetURL,
			Status:                   shortLinkStatusActive,
			RedirectMode:             accessConfig.redirectMode,
			IntermediateDelaySeconds: accessConfig.intermediateDelaySeconds,
			ExpiresAt:                accessConfig.expiresAt,
			PasswordHash:             accessConfig.passwordHash,
		})
		if isUniqueViolation(err) {
			continue
		}
		if err != nil {
			return CreateResult{}, err
		}

		shortLink := ShortLink{
			ID:        uuidFromPgtype(created.ID),
			URL:       buildShortLinkURL(domain.Host, created.Slug),
			Slug:      created.Slug,
			TargetURL: created.TargetUrl,
			Status:    created.Status,
			CreatedAt: created.CreatedAt.Time,
		}
		shortLink.setAccessConfig(created.RedirectMode, created.IntermediateDelaySeconds, created.ExpiresAt, accessConfigOptions{
			expired:         created.Expired,
			passwordEnabled: created.PasswordHash.Valid,
		})
		return CreateResult{ShortLink: shortLink}, nil
	}

	return CreateResult{}, ErrSlugConflict
}

// Overview returns aggregate metrics for short links owned by the caller.
func (s *Service) Overview(ctx context.Context, user auth.CurrentUser) (OverviewResult, error) {
	if _, err := s.authorize(ctx, user, permission.ShortLinkReadOwn); err != nil {
		return OverviewResult{}, err
	}
	ownerID, err := uuid.Parse(user.ID)
	if err != nil {
		return OverviewResult{}, err
	}
	overview, err := s.queries.GetShortLinkOverviewByOwner(ctx, uuidToPgtype(ownerID))
	if err != nil {
		return OverviewResult{}, err
	}
	return OverviewResult{
		TotalLinkCount:  overview.TotalLinkCount,
		ActiveLinkCount: overview.ActiveLinkCount,
		VisitCount:      overview.VisitCount,
		TodayVisitCount: overview.TodayVisitCount,
	}, nil
}

// List returns a paginated view of short links owned by the caller.
func (s *Service) List(ctx context.Context, user auth.CurrentUser, input ListInput) (ListResult, error) {
	if _, err := s.authorize(ctx, user, permission.ShortLinkReadOwn); err != nil {
		return ListResult{}, err
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
		shortLink := ShortLink{
			ID:        uuidFromPgtype(row.ID),
			URL:       buildShortLinkURL(row.DomainHost, row.Slug),
			Slug:      row.Slug,
			TargetURL: row.TargetUrl,
			Status:    row.Status,
			CreatedAt: row.CreatedAt.Time,
			Stats:     statsFromRow(row.VisitCount, row.TodayVisitCount, row.LastVisitedAt),
		}
		shortLink.setAccessConfig(row.RedirectMode, row.IntermediateDelaySeconds, row.ExpiresAt, accessConfigOptions{
			expired:         row.Expired,
			passwordEnabled: row.HasPassword,
		})
		items = append(items, shortLink)
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
	permissions, err := s.authorize(ctx, user, permission.ShortLinkUpdateOwn)
	if err != nil {
		return CreateResult{}, err
	}
	if input.TargetURL != nil {
		if err := validateTargetURL(*input.TargetURL); err != nil {
			return CreateResult{}, err
		}
	}
	if input.Status != nil && !isAllowedStatus(*input.Status) {
		return CreateResult{}, ErrInvalidStatus
	}
	accessConfig, err := s.updateAccessConfig(ctx, permissions, input)
	if err != nil {
		return CreateResult{}, err
	}

	linkID, ownerID, err := parseLinkAndOwnerIDs(input.ID, user.ID)
	if err != nil {
		return CreateResult{}, err
	}

	updated, err := s.queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:                       uuidToPgtype(linkID),
		OwnerID:                  uuidToPgtype(ownerID),
		TargetUrl:                optionalText(input.TargetURL),
		Status:                   optionalText(input.Status),
		RedirectMode:             accessConfig.redirectMode,
		IntermediateDelaySeconds: accessConfig.intermediateDelaySeconds,
		ExpirationMode:           accessConfig.expirationMode,
		ExpiresAt:                accessConfig.expiresAt,
		PasswordMode:             accessConfig.passwordMode,
		PasswordHash:             accessConfig.passwordHash,
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

	shortLink := ShortLink{
		ID:        uuidFromPgtype(updated.ID),
		URL:       buildShortLinkURL(domain.Host, updated.Slug),
		Slug:      updated.Slug,
		TargetURL: updated.TargetUrl,
		Status:    updated.Status,
		CreatedAt: updated.CreatedAt.Time,
	}
	shortLink.setAccessConfig(updated.RedirectMode, updated.IntermediateDelaySeconds, updated.ExpiresAt, accessConfigOptions{
		expired:         updated.Expired,
		passwordEnabled: updated.PasswordHash.Valid,
	})
	return CreateResult{ShortLink: shortLink}, nil
}

// Delete soft-deletes a short link owned by the caller.
func (s *Service) Delete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error {
	if _, err := s.authorize(ctx, user, permission.ShortLinkDeleteOwn); err != nil {
		return err
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

// Statistics returns analytics for a short link owned by the current user.
func (s *Service) Statistics(ctx context.Context, user auth.CurrentUser, input StatisticsInput) (StatisticsResult, error) {
	if _, err := s.authorize(ctx, user, permission.ShortLinkReadOwn); err != nil {
		return StatisticsResult{}, err
	}
	linkID, ownerID, err := parseLinkAndOwnerIDs(input.ID, user.ID)
	if err != nil {
		return StatisticsResult{}, ErrInvalidShortLinkID
	}
	link, err := s.analyticsLink(ctx, linkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	if link.ownerID != ownerID {
		return StatisticsResult{}, ErrShortLinkMissing
	}
	return s.analytics(ctx, linkID, link.shortLink)
}

// AdminStatistics returns analytics for a short link visible to an administrator.
func (s *Service) AdminStatistics(ctx context.Context, user auth.CurrentUser, input StatisticsInput) (StatisticsResult, error) {
	if _, err := s.authorizeAdmin(ctx, user, permission.ShortLinkReadAll); err != nil {
		return StatisticsResult{}, err
	}
	linkID, err := uuid.Parse(input.ID)
	if err != nil {
		return StatisticsResult{}, ErrInvalidShortLinkID
	}
	link, err := s.analyticsLink(ctx, linkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	return s.analytics(ctx, linkID, link.shortLink)
}

// AdminList returns a paginated, filterable view of all short links.
func (s *Service) AdminList(ctx context.Context, user auth.CurrentUser, input ListInput) (AdminListResult, error) {
	if _, err := s.authorizeAdmin(ctx, user, permission.ShortLinkReadAll); err != nil {
		return AdminListResult{}, err
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
		shortLink := AdminShortLink{
			ID:        uuidFromPgtype(row.ID),
			URL:       buildShortLinkURL(row.DomainHost, row.Slug),
			Slug:      row.Slug,
			TargetURL: row.TargetUrl,
			Status:    row.Status,
			CreatedAt: row.CreatedAt.Time,
			Stats:     statsFromRow(row.VisitCount, row.TodayVisitCount, row.LastVisitedAt),
			Owner: OwnerSummary{
				ID:       uuidFromPgtype(row.OwnerID),
				Username: row.OwnerUsername,
				Nickname: row.OwnerNickname,
			},
		}
		shortLink.setAccessConfig(row.RedirectMode, row.IntermediateDelaySeconds, row.ExpiresAt, accessConfigOptions{
			expired:         row.Expired,
			passwordEnabled: row.HasPassword,
		})
		items = append(items, shortLink)
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
	permissions, err := s.authorizeAdmin(ctx, user, permission.ShortLinkUpdateAll)
	if err != nil {
		return CreateResult{}, err
	}
	if input.TargetURL != nil {
		if err := validateTargetURL(*input.TargetURL); err != nil {
			return CreateResult{}, err
		}
	}
	if input.Status != nil && !isAllowedStatus(*input.Status) {
		return CreateResult{}, ErrInvalidStatus
	}
	accessConfig, err := s.updateAccessConfig(ctx, permissions, input)
	if err != nil {
		return CreateResult{}, err
	}

	linkID, err := uuid.Parse(input.ID)
	if err != nil {
		return CreateResult{}, err
	}
	updated, err := s.queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:                       uuidToPgtype(linkID),
		TargetUrl:                optionalText(input.TargetURL),
		Status:                   optionalText(input.Status),
		RedirectMode:             accessConfig.redirectMode,
		IntermediateDelaySeconds: accessConfig.intermediateDelaySeconds,
		ExpirationMode:           accessConfig.expirationMode,
		ExpiresAt:                accessConfig.expiresAt,
		PasswordMode:             accessConfig.passwordMode,
		PasswordHash:             accessConfig.passwordHash,
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

	shortLink := ShortLink{
		ID:        uuidFromPgtype(updated.ID),
		URL:       buildShortLinkURL(domain.Host, updated.Slug),
		Slug:      updated.Slug,
		TargetURL: updated.TargetUrl,
		Status:    updated.Status,
		CreatedAt: updated.CreatedAt.Time,
	}
	shortLink.setAccessConfig(updated.RedirectMode, updated.IntermediateDelaySeconds, updated.ExpiresAt, accessConfigOptions{
		expired:         updated.Expired,
		passwordEnabled: updated.PasswordHash.Valid,
	})
	return CreateResult{ShortLink: shortLink}, nil
}

// AdminDelete soft-deletes any short link.
func (s *Service) AdminDelete(ctx context.Context, user auth.CurrentUser, input DeleteInput) error {
	if _, err := s.authorizeAdmin(ctx, user, permission.ShortLinkDeleteAll); err != nil {
		return err
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

type analyticsLinkResult struct {
	ownerID   uuid.UUID
	shortLink ShortLink
}

type analyticsQueries interface {
	GetShortLinkAnalyticsSummary(context.Context, pgtype.UUID) (sqlc.GetShortLinkAnalyticsSummaryRow, error)
	ListShortLinkDailyVisits(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDailyVisitsRow, error)
	ListShortLinkReferrerStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkReferrerStatsRow, error)
	ListShortLinkDeviceStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkDeviceStatsRow, error)
	ListShortLinkCountryStats(context.Context, pgtype.UUID) ([]sqlc.ListShortLinkCountryStatsRow, error)
}

// analyticsLink returns a non-deleted link formatted for analytics responses.
func (s *Service) analyticsLink(ctx context.Context, linkID uuid.UUID) (analyticsLinkResult, error) {
	row, err := s.queries.GetShortLinkAnalyticsLink(ctx, uuidToPgtype(linkID))
	if errors.Is(err, pgx.ErrNoRows) {
		return analyticsLinkResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return analyticsLinkResult{}, err
	}
	shortLink := ShortLink{
		ID:        uuidFromPgtype(row.ID),
		URL:       buildShortLinkURL(row.DomainHost, row.Slug),
		Slug:      row.Slug,
		TargetURL: row.TargetUrl,
		Status:    row.Status,
		CreatedAt: row.CreatedAt.Time,
	}
	shortLink.setAccessConfig(row.RedirectMode, row.IntermediateDelaySeconds, row.ExpiresAt, accessConfigOptions{
		expired:         row.Expired,
		passwordEnabled: row.HasPassword,
	})
	return analyticsLinkResult{
		ownerID:   uuid.UUID(row.OwnerID.Bytes),
		shortLink: shortLink,
	}, nil
}

// analytics assembles summary, trend, and dimension aggregates for one visible link.
func (s *Service) analytics(ctx context.Context, linkID uuid.UUID, shortLink ShortLink) (StatisticsResult, error) {
	return analyticsWithQueries(ctx, s.queries, linkID, shortLink)
}

// analyticsWithQueries assembles analytics using the supplied aggregate query reader.
func analyticsWithQueries(ctx context.Context, queries analyticsQueries, linkID uuid.UUID, shortLink ShortLink) (StatisticsResult, error) {
	pgLinkID := uuidToPgtype(linkID)
	summary, err := queries.GetShortLinkAnalyticsSummary(ctx, pgLinkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	trend, err := queries.ListShortLinkDailyVisits(ctx, pgLinkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	referrers, err := queries.ListShortLinkReferrerStats(ctx, pgLinkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	devices, err := queries.ListShortLinkDeviceStats(ctx, pgLinkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	countries, err := queries.ListShortLinkCountryStats(ctx, pgLinkID)
	if err != nil {
		return StatisticsResult{}, err
	}
	stats := AnalyticsStats{
		VisitCount:      summary.VisitCount,
		TodayVisitCount: summary.TodayVisitCount,
		Trend:           trendFromRows(trend),
		Referrers:       referrerDimensions(referrers),
		Devices:         deviceDimensions(devices),
		Countries:       countryDimensions(countries),
	}
	if summary.LastVisitedAt.Valid {
		stats.LastVisitedAt = &summary.LastVisitedAt.Time
	}
	return StatisticsResult{ShortLink: shortLink, Stats: stats}, nil
}

// trendFromRows maps generated day aggregates to the API response.
func trendFromRows(rows []sqlc.ListShortLinkDailyVisitsRow) []AnalyticsTrendPoint {
	items := make([]AnalyticsTrendPoint, 0, len(rows))
	for _, row := range rows {
		items = append(items, AnalyticsTrendPoint{Date: row.Day.Time.Format("2006-01-02"), VisitCount: row.VisitCount})
	}
	return items
}

// referrerDimensions maps referrer aggregation rows to API dimensions.
func referrerDimensions(rows []sqlc.ListShortLinkReferrerStatsRow) []AnalyticsDimension {
	items := make([]AnalyticsDimension, 0, len(rows))
	for _, row := range rows {
		items = append(items, AnalyticsDimension{Value: row.Value, VisitCount: row.VisitCount})
	}
	return items
}

// deviceDimensions maps device aggregation rows to API dimensions.
func deviceDimensions(rows []sqlc.ListShortLinkDeviceStatsRow) []AnalyticsDimension {
	items := make([]AnalyticsDimension, 0, len(rows))
	for _, row := range rows {
		items = append(items, AnalyticsDimension{Value: row.Value, VisitCount: row.VisitCount})
	}
	return items
}

// countryDimensions maps country aggregation rows to API dimensions.
func countryDimensions(rows []sqlc.ListShortLinkCountryStatsRow) []AnalyticsDimension {
	items := make([]AnalyticsDimension, 0, len(rows))
	for _, row := range rows {
		items = append(items, AnalyticsDimension{Value: row.Value, VisitCount: row.VisitCount})
	}
	return items
}

type createAccessConfigParams struct {
	redirectMode             string
	intermediateDelaySeconds int16
	expiresAt                pgtype.Timestamptz
	passwordHash             pgtype.Text
}

type updateAccessConfigParams struct {
	redirectMode             pgtype.Text
	intermediateDelaySeconds pgtype.Int2
	expirationMode           string
	expiresAt                pgtype.Timestamptz
	passwordMode             string
	passwordHash             pgtype.Text
}

type accessConfigAuthorizationInput struct {
	redirectMode                 *string
	intermediateDelaySeconds     *int16
	intermediateDelayWasExplicit bool
	expiration                   *ExpirationInput
	password                     *PasswordInput
}

type accessConfigAuthorization struct {
	expirationMode string
	expiresAt      pgtype.Timestamptz
	passwordMode   string
	passwordHash   pgtype.Text
}

// createAccessConfig normalizes defaults and validates advanced creation settings.
func (s *Service) createAccessConfig(ctx context.Context, permissions permission.Snapshot, input CreateInput) (createAccessConfigParams, error) {
	redirectMode := input.RedirectMode
	if redirectMode == "" {
		redirectMode = RedirectModeDirect
	}
	delay := defaultIntermediateDelay
	if input.IntermediateDelaySeconds != nil {
		delay = *input.IntermediateDelaySeconds
	}
	authorization, err := s.authorizeAccessConfig(ctx, permissions, accessConfigAuthorizationInput{
		redirectMode:                 &redirectMode,
		intermediateDelaySeconds:     &delay,
		intermediateDelayWasExplicit: input.IntermediateDelaySeconds != nil,
		expiration:                   input.Expiration,
		password:                     input.Password,
	})
	if err != nil {
		return createAccessConfigParams{}, err
	}
	return createAccessConfigParams{
		redirectMode:             redirectMode,
		intermediateDelaySeconds: delay,
		expiresAt:                authorization.expiresAt,
		passwordHash:             authorization.passwordHash,
	}, nil
}

// updateAccessConfig validates only fields explicitly present in an update request.
func (s *Service) updateAccessConfig(ctx context.Context, permissions permission.Snapshot, input UpdateInput) (updateAccessConfigParams, error) {
	authorization, err := s.authorizeAccessConfig(ctx, permissions, accessConfigAuthorizationInput{
		redirectMode:                 input.RedirectMode,
		intermediateDelaySeconds:     input.IntermediateDelaySeconds,
		intermediateDelayWasExplicit: input.IntermediateDelaySeconds != nil,
		expiration:                   input.Expiration,
		password:                     input.Password,
	})
	if err != nil {
		return updateAccessConfigParams{}, err
	}
	return updateAccessConfigParams{
		redirectMode:             optionalText(input.RedirectMode),
		intermediateDelaySeconds: optionalInt2(input.IntermediateDelaySeconds),
		expirationMode:           authorization.expirationMode,
		expiresAt:                authorization.expiresAt,
		passwordMode:             authorization.passwordMode,
		passwordHash:             authorization.passwordHash,
	}, nil
}

// authorizeAccessConfig validates access settings and preserves their permission and normalization order.
func (s *Service) authorizeAccessConfig(ctx context.Context, permissions permission.Snapshot, input accessConfigAuthorizationInput) (accessConfigAuthorization, error) {
	if input.redirectMode != nil && !isAllowedRedirectMode(*input.redirectMode) {
		return accessConfigAuthorization{}, ErrInvalidRedirectMode
	}
	if input.intermediateDelaySeconds != nil && !isAllowedIntermediateDelay(*input.intermediateDelaySeconds) {
		return accessConfigAuthorization{}, ErrInvalidIntermediateDelay
	}
	if input.redirectMode != nil {
		required := redirectModePermission(*input.redirectMode)
		if required != "" && !permissions.Has(required) {
			return accessConfigAuthorization{}, ErrPermissionDenied
		}
	}
	if input.intermediateDelayWasExplicit && !permissions.Has(permission.ShortLinkUseIntermediate) {
		return accessConfigAuthorization{}, ErrPermissionDenied
	}
	if input.expiration != nil && !permissions.Has(permission.ShortLinkSetExpiration) {
		return accessConfigAuthorization{}, ErrPermissionDenied
	}

	expirationMode, expiresAt, err := s.normalizeExpiration(ctx, input.expiration)
	if err != nil {
		return accessConfigAuthorization{}, err
	}
	passwordMode, passwordHash, err := normalizePassword(permissions, input.password)
	if err != nil {
		return accessConfigAuthorization{}, err
	}
	return accessConfigAuthorization{
		expirationMode: expirationMode,
		expiresAt:      expiresAt,
		passwordMode:   passwordMode,
		passwordHash:   passwordHash,
	}, nil
}

// normalizePassword enforces password capability and returns only a persistence-safe hash.
func normalizePassword(permissions permission.Snapshot, input *PasswordInput) (string, pgtype.Text, error) {
	if input != nil && !permissions.Has(permission.ShortLinkSetPassword) {
		return "", pgtype.Text{}, ErrPermissionDenied
	}
	mode, raw, err := validatePasswordInput(input)
	if err != nil || mode != PasswordModeSet {
		return mode, pgtype.Text{}, err
	}
	hash, err := auth.HashPassword(raw)
	if err != nil {
		return "", pgtype.Text{}, err
	}
	return mode, pgtype.Text{String: hash, Valid: true}, nil
}

// validatePasswordInput normalizes password update modes and validates raw password length.
func validatePasswordInput(input *PasswordInput) (string, string, error) {
	if input == nil {
		return passwordModeKeep, "", nil
	}
	switch input.Mode {
	case PasswordModeNever:
		if input.Value != "" {
			return "", "", ErrInvalidPasswordInput
		}
		return PasswordModeNever, "", nil
	case PasswordModeSet:
		length := utf8.RuneCountInString(input.Value)
		if length < minPasswordLength || length > maxPasswordLength {
			return "", "", ErrInvalidPasswordInput
		}
		return PasswordModeSet, input.Value, nil
	default:
		return "", "", ErrInvalidPasswordInput
	}
}

// normalizeExpiration validates an expiration update against authoritative database time.
func (s *Service) normalizeExpiration(ctx context.Context, input *ExpirationInput) (string, pgtype.Timestamptz, error) {
	if input == nil {
		return expirationModeKeep, pgtype.Timestamptz{}, nil
	}
	switch input.Mode {
	case ExpirationModeNever:
		if input.ExpiresAt != nil {
			return "", pgtype.Timestamptz{}, ErrInvalidExpiration
		}
		return ExpirationModeNever, pgtype.Timestamptz{}, nil
	case ExpirationModeAt:
		if input.ExpiresAt == nil {
			return "", pgtype.Timestamptz{}, ErrInvalidExpiration
		}
		databaseTime, err := s.queries.GetDatabaseTime(ctx)
		if err != nil {
			return "", pgtype.Timestamptz{}, err
		}
		if !input.ExpiresAt.After(databaseTime.Time) {
			return "", pgtype.Timestamptz{}, ErrInvalidExpiration
		}
		return ExpirationModeAt, pgtype.Timestamptz{Time: input.ExpiresAt.UTC(), Valid: true}, nil
	default:
		return "", pgtype.Timestamptz{}, ErrInvalidExpiration
	}
}

// isAllowedRedirectMode reports whether a redirect mode belongs to the persisted contract.
func isAllowedRedirectMode(value string) bool {
	return value == RedirectModeDirect || value == RedirectModeIntermediate || value == RedirectModeConfirmation
}

// redirectModePermission returns the capability required by an interactive mode.
func redirectModePermission(value string) string {
	switch value {
	case RedirectModeIntermediate:
		return permission.ShortLinkUseIntermediate
	case RedirectModeConfirmation:
		return permission.ShortLinkUseConfirmation
	default:
		return ""
	}
}

// isAllowedIntermediateDelay reports whether an intermediate delay is within product bounds.
func isAllowedIntermediateDelay(value int16) bool {
	return value >= minIntermediateDelay && value <= maxIntermediateDelay
}

// optionalInt2 converts an optional delay into the nullable SQLC representation.
func optionalInt2(value *int16) pgtype.Int2 {
	if value == nil {
		return pgtype.Int2{}
	}
	return pgtype.Int2{Int16: *value, Valid: true}
}

// expirationValues maps a stored expiration and derived state into the API model.
func expirationValues(value pgtype.Timestamptz, expired bool) (*time.Time, bool) {
	if !value.Valid {
		return nil, false
	}
	expiresAt := value.Time
	return &expiresAt, expired
}

// authorize resolves one reusable permission snapshot and checks every requested capability.
func (s *Service) authorize(ctx context.Context, user auth.CurrentUser, requiredPermissions ...string) (permission.Snapshot, error) {
	permissions, err := s.permissions.Resolve(ctx, user.GroupKey)
	if err != nil {
		return permission.Snapshot{}, err
	}
	for _, required := range requiredPermissions {
		if !permissions.Has(required) {
			return permission.Snapshot{}, ErrPermissionDenied
		}
	}
	return permissions, nil
}

// authorizeAdmin resolves one snapshot and checks administrative access plus the requested capability.
func (s *Service) authorizeAdmin(ctx context.Context, user auth.CurrentUser, required string) (permission.Snapshot, error) {
	return s.authorize(ctx, user, permission.AdminAccess, required)
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

var errPermissionResolverRequired = errors.New("short link permission resolver is required")

type missingPermissionResolver struct{}

// Resolve rejects permission checks when the service dependency is missing.
func (missingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, errPermissionResolverRequired
}
