package user

import (
	"context"
	"errors"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
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

func validStatus(status string) bool {
	return status == "active" || status == "disabled"
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
