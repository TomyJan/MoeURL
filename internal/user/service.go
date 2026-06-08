package user

import (
	"context"
	"errors"
	"time"

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
	defaultPage     int32 = 1
	defaultPageSize int32 = 20
	maxPageSize     int32 = 100
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

func (s *Service) Create(ctx context.Context, actor auth.CurrentUser, input CreateInput) (CreateResult, error) {
	if !s.permissions.Has(actor.GroupKey, permission.AdminAccess) {
		return CreateResult{}, ErrPermissionDenied
	}
	if input.Username == "" || input.Password == "" || input.Nickname == "" || input.GroupKey == "" || !validStatus(input.Status) {
		return CreateResult{}, ErrInvalidInput
	}

	group, err := s.queries.GetUserGroupByKey(ctx, input.GroupKey)
	if err != nil {
		return CreateResult{}, err
	}
	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return CreateResult{}, err
	}

	created, err := s.queries.CreateAppUser(ctx, sqlc.CreateAppUserParams{
		ID:           uuidToPgtype(uuid.New()),
		Username:     input.Username,
		PasswordHash: pgtype.Text{String: hash, Valid: true},
		Nickname:     input.Nickname,
		GroupID:      group.ID,
		Status:       input.Status,
		Builtin:      false,
	})
	if isUniqueViolation(err) {
		return CreateResult{}, ErrUsernameExists
	}
	if err != nil {
		return CreateResult{}, err
	}

	return CreateResult{
		User: CreatedUser{
			ID:       uuidFromPgtype(created.ID),
			Username: created.Username,
			Nickname: created.Nickname,
			Group:    input.GroupKey,
			Status:   created.Status,
		},
	}, nil
}

func (s *Service) List(ctx context.Context, actor auth.CurrentUser, input ListInput) (ListResult, error) {
	if !s.permissions.Has(actor.GroupKey, permission.AdminAccess) {
		return ListResult{}, ErrPermissionDenied
	}

	page, pageSize := normalizePagination(input)
	total, err := s.queries.CountAppUsers(ctx)
	if err != nil {
		return ListResult{}, err
	}
	rows, err := s.queries.ListAppUsers(ctx, sqlc.ListAppUsersParams{
		Limit:  pageSize,
		Offset: (page - 1) * pageSize,
	})
	if err != nil {
		return ListResult{}, err
	}

	items := make([]UserSummary, 0, len(rows))
	for _, row := range rows {
		items = append(items, UserSummary{
			ID:        uuidFromPgtype(row.ID),
			Username:  row.Username,
			Nickname:  row.Nickname,
			Group:     row.GroupKey,
			Status:    row.Status,
			Builtin:   row.Builtin,
			CreatedAt: formatTime(row.CreatedAt),
			UpdatedAt: formatTime(row.UpdatedAt),
		})
	}

	return ListResult{Items: items, Page: page, PageSize: pageSize, Total: total}, nil
}

func (s *Service) Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (UpdateResult, error) {
	if !s.permissions.Has(actor.GroupKey, permission.AdminAccess) {
		return UpdateResult{}, ErrPermissionDenied
	}
	if input.ID == "" || input.Nickname == "" || !validStatus(input.Status) {
		return UpdateResult{}, ErrInvalidInput
	}

	userID, err := uuid.Parse(input.ID)
	if err != nil {
		return UpdateResult{}, ErrInvalidInput
	}
	existing, err := s.queries.GetAppUserMetaByID(ctx, uuidToPgtype(userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdateResult{}, ErrUserNotFound
	}
	if err != nil {
		return UpdateResult{}, err
	}
	if existing.Builtin {
		return UpdateResult{}, ErrBuiltinUserImmutable
	}

	updated, err := s.queries.UpdateAppUserProfile(ctx, sqlc.UpdateAppUserProfileParams{
		ID:       uuidToPgtype(userID),
		Nickname: input.Nickname,
		Status:   input.Status,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdateResult{}, ErrUserNotFound
	}
	if err != nil {
		return UpdateResult{}, err
	}
	group, err := s.queries.GetUserGroupByID(ctx, updated.GroupID)
	if err != nil {
		return UpdateResult{}, err
	}

	return UpdateResult{User: UserSummary{
		ID:        uuidFromPgtype(updated.ID),
		Username:  updated.Username,
		Nickname:  updated.Nickname,
		Group:     group.Key,
		Status:    updated.Status,
		Builtin:   updated.Builtin,
		CreatedAt: formatTime(updated.CreatedAt),
		UpdatedAt: formatTime(updated.UpdatedAt),
	}}, nil
}

func (s *Service) ResetPassword(ctx context.Context, actor auth.CurrentUser, input ResetPasswordInput) error {
	if !s.permissions.Has(actor.GroupKey, permission.AdminAccess) {
		return ErrPermissionDenied
	}
	if input.ID == "" || input.Password == "" {
		return ErrInvalidInput
	}

	userID, err := uuid.Parse(input.ID)
	if err != nil {
		return ErrInvalidInput
	}
	existing, err := s.queries.GetAppUserByID(ctx, uuidToPgtype(userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserNotFound
	}
	if err != nil {
		return err
	}
	if existing.Builtin {
		return ErrBuiltinUserImmutable
	}
	hash, err := auth.HashPassword(input.Password)
	if err != nil {
		return err
	}
	rows, err := s.queries.UpdateAppUserPassword(ctx, sqlc.UpdateAppUserPasswordParams{
		ID:           uuidToPgtype(userID),
		PasswordHash: pgtype.Text{String: hash, Valid: true},
	})
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrUserNotFound
	}
	return nil
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

func validStatus(status string) bool {
	return status == "active" || status == "disabled"
}

func formatTime(value pgtype.Timestamptz) string {
	if !value.Valid {
		return ""
	}
	return value.Time.UTC().Format(time.RFC3339)
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

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
