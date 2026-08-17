package user

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
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
	pool        *pgxpool.Pool
	queries     *sqlc.Queries
	permissions permission.Resolver
}

type missingPermissionResolver struct{}

// Resolve rejects permission checks when the service dependency is missing.
func (missingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, errPermissionResolverRequired
}

// NewService creates a user service backed by SQLC queries and permissions.
func NewService(pool *pgxpool.Pool, permissions permission.Resolver) *Service {
	if permissions == nil {
		permissions = missingPermissionResolver{}
	}
	return &Service{
		pool:        pool,
		queries:     sqlc.New(pool),
		permissions: permissions,
	}
}

// Create adds an administrator-managed user after validating its input.
func (s *Service) Create(ctx context.Context, actor auth.CurrentUser, input CreateInput) (CreateResult, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return CreateResult{}, err
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

// List returns a paginated list of users for administrators.
func (s *Service) List(ctx context.Context, actor auth.CurrentUser, input ListInput) (ListResult, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return ListResult{}, err
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

// Update changes an administrator-managed user's profile and status.
func (s *Service) Update(ctx context.Context, actor auth.CurrentUser, input UpdateInput) (UpdateResult, error) {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return UpdateResult{}, err
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

// UpdateProfile changes the current user's own nickname.
func (s *Service) UpdateProfile(ctx context.Context, actor auth.CurrentUser, input UpdateProfileInput) (UpdateProfileResult, error) {
	if actor.GroupKey == permission.GroupGuest || actor.ID == "" {
		return UpdateProfileResult{}, ErrPermissionDenied
	}

	nickname := strings.TrimSpace(input.Nickname)
	if nickname == "" {
		return UpdateProfileResult{}, ErrInvalidInput
	}
	if utf8.RuneCountInString(nickname) > NicknameMaxLength {
		return UpdateProfileResult{}, ErrInvalidInput
	}

	userID, err := uuid.Parse(actor.ID)
	if err != nil {
		return UpdateProfileResult{}, ErrInvalidInput
	}
	existing, err := s.queries.GetAppUserMetaByID(ctx, uuidToPgtype(userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdateProfileResult{}, ErrUserNotFound
	}
	if err != nil {
		return UpdateProfileResult{}, err
	}
	if existing.Builtin {
		return UpdateProfileResult{}, ErrBuiltinUserImmutable
	}

	var updated sqlc.AppUser
	var group sqlc.UserGroup
	var permissions []string
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		txQueries := s.queries.WithTx(tx)
		var err error
		updated, err = txQueries.UpdateAppUserNickname(ctx, sqlc.UpdateAppUserNicknameParams{
			ID:       uuidToPgtype(userID),
			Nickname: nickname,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserNotFound
		}
		if err != nil {
			return err
		}
		group, err = txQueries.GetUserGroupByID(ctx, updated.GroupID)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(group.Permissions, &permissions); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return UpdateProfileResult{}, err
	}

	return UpdateProfileResult{User: auth.CurrentUser{
		ID:          uuidFromPgtype(updated.ID),
		Username:    updated.Username,
		Nickname:    updated.Nickname,
		GroupKey:    group.Key,
		Permissions: permissions,
	}}, nil
}

// ResetPassword replaces the password of a non-built-in user.
func (s *Service) ResetPassword(ctx context.Context, actor auth.CurrentUser, input ResetPasswordInput) error {
	if err := s.authorizeAdmin(ctx, actor); err != nil {
		return err
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

// authorizeAdmin resolves one permission snapshot for a managed-user operation.
func (s *Service) authorizeAdmin(ctx context.Context, actor auth.CurrentUser) error {
	permissions, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return err
	}
	if !permissions.Has(permission.AdminAccess) {
		return ErrPermissionDenied
	}
	return nil
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

// validStatus reports whether a user status can be persisted.
func validStatus(status string) bool {
	return status == "active" || status == "disabled"
}

// formatTime renders a nullable PostgreSQL timestamp for API responses.
func formatTime(value pgtype.Timestamptz) string {
	if !value.Valid {
		return ""
	}
	return value.Time.UTC().Format(time.RFC3339)
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

// isUniqueViolation reports whether an error is a PostgreSQL unique constraint violation.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

var errPermissionResolverRequired = errors.New("user permission resolver is required")
