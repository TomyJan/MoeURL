package usergroup

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
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func normalizeCustomGroupDetails(name, description string) (string, string, error) {
	name = strings.TrimSpace(name)
	nameLength := utf8.RuneCountInString(name)
	if nameLength < 1 || nameLength > 64 || utf8.RuneCountInString(description) > 500 {
		return "", "", ErrInvalidInput
	}
	return name, description, nil
}

type CustomPort interface {
	Create(context.Context, auth.CurrentUser, CreateCustomGroupInput) (UpdatePermissionsResult, error)
	UpdateDetails(context.Context, auth.CurrentUser, UpdateCustomGroupDetailsInput) (UpdatePermissionsResult, error)
	UpdatePermissions(context.Context, auth.CurrentUser, UpdatePermissionsInput) (UpdatePermissionsResult, error)
	Delete(context.Context, auth.CurrentUser, DeleteCustomGroupInput) (DeleteCustomGroupResult, error)
}

type CustomService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

type CreateCustomGroupInput struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type UpdateCustomGroupDetailsInput struct {
	GroupKey          string `json:"groupKey"`
	Name              string `json:"name"`
	Description       string `json:"description"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

type DeleteCustomGroupInput struct {
	GroupKey          string `json:"groupKey"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

type DeleteCustomGroupResult struct {
	GroupKey string `json:"groupKey"`
	Name     string `json:"name"`
}

func NewCustomService(pool *pgxpool.Pool) *CustomService {
	return &CustomService{pool: pool, queries: sqlc.New(pool)}
}

func (s *CustomService) Create(ctx context.Context, actor auth.CurrentUser, input CreateCustomGroupInput) (UpdatePermissionsResult, error) {
	name, description, err := normalizeCustomGroupDetails(input.Name, input.Description)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	var row sqlc.UserGroup
	err = s.withWrite(ctx, actor, func(writeCtx context.Context, q *sqlc.Queries) error {
		id := uuid.New()
		row, err = q.CreateCustomUserGroup(writeCtx, sqlc.CreateCustomUserGroupParams{
			ID: pgtype.UUID{Bytes: id, Valid: true}, GroupKey: id.String(), Name: name, Description: description,
		})
		return mapCustomGroupNameConflict(err)
	})
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group, err := userGroupFromRow(row)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	return UpdatePermissionsResult{Group: group}, nil
}

func (s *CustomService) UpdateDetails(ctx context.Context, actor auth.CurrentUser, input UpdateCustomGroupDetailsInput) (UpdatePermissionsResult, error) {
	name, description, err := normalizeCustomGroupDetails(input.Name, input.Description)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	expected, err := parseCustomGroupRevision(input.ExpectedUpdatedAt)
	if err != nil || input.GroupKey == "" {
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	var row sqlc.UserGroup
	var memberCount int64
	err = s.withWrite(ctx, actor, func(writeCtx context.Context, q *sqlc.Queries) error {
		current, err := q.LockUserGroupForCustomManagement(writeCtx, input.GroupKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserGroupNotFound
		}
		if err != nil {
			return err
		}
		if current.Builtin || isReservedBuiltinGroupKey(current.Key) {
			return ErrProtectedGroup
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrPermissionConflict
		}
		row, err = q.UpdateCustomUserGroupDetails(writeCtx, sqlc.UpdateCustomUserGroupDetailsParams{
			Name: name, Description: description, GroupKey: input.GroupKey,
			ExpectedUpdatedAt: pgtype.Timestamptz{Time: expected, Valid: true},
		})
		if err := mapCustomGroupNameConflict(err); err != nil {
			return err
		}
		memberCount, err = customGroupMemberCount(writeCtx, q, input.GroupKey)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdatePermissionsResult{}, ErrPermissionConflict
	}
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group, err := userGroupFromRow(row)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group.MemberCount = memberCount
	return UpdatePermissionsResult{Group: group}, nil
}

func (s *CustomService) UpdatePermissions(ctx context.Context, actor auth.CurrentUser, input UpdatePermissionsInput) (UpdatePermissionsResult, error) {
	expected, err := parseCustomGroupRevision(input.ExpectedUpdatedAt)
	if err != nil || input.GroupKey == "" || input.Permissions == nil {
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	normalized, err := permission.NormalizeCustomGroup(input.Permissions)
	if err != nil {
		if errors.Is(err, permission.ErrProtectedPermission) {
			return UpdatePermissionsResult{}, ErrProtectedPermission
		}
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	encoded, err := json.Marshal(normalized)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	var row sqlc.UserGroup
	var memberCount int64
	err = s.withWrite(ctx, actor, func(writeCtx context.Context, q *sqlc.Queries) error {
		current, err := q.LockUserGroupForCustomManagement(writeCtx, input.GroupKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserGroupNotFound
		}
		if err != nil {
			return err
		}
		if current.Builtin || isReservedBuiltinGroupKey(current.Key) {
			return ErrProtectedPermission
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrPermissionConflict
		}
		row, err = q.UpdateCustomUserGroupPermissions(writeCtx, sqlc.UpdateCustomUserGroupPermissionsParams{
			Permissions: encoded, GroupKey: input.GroupKey,
			ExpectedUpdatedAt: pgtype.Timestamptz{Time: expected, Valid: true},
		})
		if err != nil {
			return err
		}
		memberCount, err = customGroupMemberCount(writeCtx, q, input.GroupKey)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdatePermissionsResult{}, ErrPermissionConflict
	}
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group, err := userGroupFromRow(row)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group.MemberCount = memberCount
	return UpdatePermissionsResult{Group: group}, nil
}

func (s *CustomService) Delete(ctx context.Context, actor auth.CurrentUser, input DeleteCustomGroupInput) (DeleteCustomGroupResult, error) {
	expected, err := parseCustomGroupRevision(input.ExpectedUpdatedAt)
	if err != nil || input.GroupKey == "" {
		return DeleteCustomGroupResult{}, ErrInvalidInput
	}
	var result DeleteCustomGroupResult
	err = s.withWrite(ctx, actor, func(writeCtx context.Context, q *sqlc.Queries) error {
		current, err := q.LockUserGroupForCustomManagement(writeCtx, input.GroupKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserGroupNotFound
		}
		if err != nil {
			return err
		}
		if current.Builtin || isReservedBuiltinGroupKey(current.Key) {
			return ErrProtectedGroup
		}
		if !current.UpdatedAt.Time.Equal(expected) {
			return ErrPermissionConflict
		}
		groups, err := q.ListUserGroups(writeCtx)
		if err != nil {
			return err
		}
		for _, group := range groups {
			if group.Key == input.GroupKey && group.MemberCount > 0 {
				return ErrUserGroupHasMembers
			}
		}
		deleted, err := q.DeleteCustomUserGroup(writeCtx, input.GroupKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrUserGroupHasMembers
		}
		if err != nil {
			return err
		}
		result = DeleteCustomGroupResult{GroupKey: deleted.Key, Name: deleted.Name}
		return nil
	})
	return result, err
}

func (s *CustomService) withWrite(ctx context.Context, actor auth.CurrentUser, fn func(context.Context, *sqlc.Queries) error) error {
	actorID, err := groupWriterID(actor.ID)
	if err != nil {
		return err
	}
	if s.pool == nil {
		return errors.New("custom user-group database is unavailable")
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := domain.LockShortLinkCreation(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		if _, err := authorizeGroupWriter(ctx, q, actorID, false); err != nil {
			return err
		}
		return fn(ctx, q)
	})
}

func parseCustomGroupRevision(value string) (time.Time, error) {
	revision, err := time.Parse(time.RFC3339Nano, value)
	if err != nil || revision.IsZero() || !groupRevisionPattern.MatchString(value) {
		return time.Time{}, ErrInvalidInput
	}
	return revision.UTC(), nil
}

func mapCustomGroupNameConflict(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == "user_group_normalized_name_uidx" {
		return ErrUserGroupNameConflict
	}
	return err
}

func customGroupMemberCount(ctx context.Context, q *sqlc.Queries, groupKey string) (int64, error) {
	groups, err := q.ListUserGroups(ctx)
	if err != nil {
		return 0, err
	}
	for _, group := range groups {
		if group.Key == groupKey {
			return group.MemberCount, nil
		}
	}
	return 0, ErrUserGroupNotFound
}

var _ CustomPort = (*CustomService)(nil)
