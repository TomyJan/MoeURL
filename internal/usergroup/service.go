package usergroup

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Port exposes built-in user-group permission management.
type Port interface {
	List(context.Context, auth.CurrentUser) (ListResult, error)
	UpdatePermissions(context.Context, auth.CurrentUser, UpdatePermissionsInput) (UpdatePermissionsResult, error)
}

// Service manages built-in user-group permissions through SQLC.
type Service struct {
	queries     groupQueries
	permissions permission.Resolver
}

// groupQueries contains the SQLC operations needed by Service.
type groupQueries interface {
	ListBuiltinUserGroups(context.Context) ([]sqlc.UserGroup, error)
	UpdateBuiltinUserGroupPermissions(context.Context, sqlc.UpdateBuiltinUserGroupPermissionsParams) (sqlc.UserGroup, error)
	GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error)
}

// missingPermissionResolver rejects operations when authorization cannot use the database.
type missingPermissionResolver struct{}

// Resolve always rejects a missing permission resolver.
func (missingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, ErrPermissionResolverNeeded
}

var marshalPermissions = json.Marshal

// NewService creates a database-backed user-group service.
func NewService(pool *pgxpool.Pool, permissions permission.Resolver) *Service {
	if permissions == nil {
		permissions = missingPermissionResolver{}
	}
	return &Service{
		queries:     sqlc.New(pool),
		permissions: permissions,
	}
}

// List returns the built-in groups and stable permission catalog.
func (s *Service) List(ctx context.Context, actor auth.CurrentUser) (ListResult, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return ListResult{}, err
	}

	rows, err := s.queries.ListBuiltinUserGroups(ctx)
	if err != nil {
		return ListResult{}, err
	}
	groups := make([]UserGroup, 0, len(rows))
	for _, row := range rows {
		group, err := userGroupFromRow(row)
		if err != nil {
			return ListResult{}, err
		}
		groups = append(groups, group)
	}
	return ListResult{
		Groups:      groups,
		Permissions: permission.Definitions(),
		Presets:     permission.Presets(),
	}, nil
}

// UpdatePermissions conditionally replaces one editable built-in group's permissions.
func (s *Service) UpdatePermissions(ctx context.Context, actor auth.CurrentUser, input UpdatePermissionsInput) (UpdatePermissionsResult, error) {
	if err := s.authorize(ctx, actor); err != nil {
		return UpdatePermissionsResult{}, err
	}
	if input.GroupKey == permission.GroupGuest {
		return UpdatePermissionsResult{}, ErrProtectedPermission
	}
	if input.GroupKey != permission.GroupUser && input.GroupKey != permission.GroupAdmin {
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	expectedUpdatedAt, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil {
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	if input.Permissions == nil {
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	normalized, err := permission.NormalizeForGroup(input.GroupKey, input.Permissions)
	if err != nil {
		if errors.Is(err, permission.ErrProtectedPermission) {
			return UpdatePermissionsResult{}, ErrProtectedPermission
		}
		return UpdatePermissionsResult{}, ErrInvalidInput
	}
	encoded, err := marshalPermissions(normalized)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}

	row, err := s.queries.UpdateBuiltinUserGroupPermissions(ctx, sqlc.UpdateBuiltinUserGroupPermissionsParams{
		Permissions:       encoded,
		GroupKey:          input.GroupKey,
		ExpectedUpdatedAt: pgtype.Timestamptz{Time: expectedUpdatedAt.UTC(), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return UpdatePermissionsResult{}, s.classifyConditionalMiss(ctx, input.GroupKey)
	}
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	group, err := userGroupFromRow(row)
	if err != nil {
		return UpdatePermissionsResult{}, err
	}
	return UpdatePermissionsResult{Group: group}, nil
}

// authorize resolves exactly one permission snapshot for the operation.
func (s *Service) authorize(ctx context.Context, actor auth.CurrentUser) error {
	snapshot, err := s.permissions.Resolve(ctx, actor.GroupKey)
	if err != nil {
		return err
	}
	if !snapshot.Has(permission.AdminAccess) {
		return ErrPermissionDenied
	}
	return nil
}

// classifyConditionalMiss distinguishes a missing built-in group from a stale timestamp.
func (s *Service) classifyConditionalMiss(ctx context.Context, groupKey string) error {
	group, err := s.queries.GetUserGroupByKey(ctx, groupKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUserGroupNotFound
	}
	if err != nil {
		return err
	}
	if !group.Builtin {
		return ErrUserGroupNotFound
	}
	return ErrPermissionConflict
}

// userGroupFromRow validates stored permissions and formats the public model.
func userGroupFromRow(row sqlc.UserGroup) (UserGroup, error) {
	var stored []string
	if err := json.Unmarshal(row.Permissions, &stored); err != nil {
		return UserGroup{}, err
	}
	normalized, err := permission.NormalizeForGroup(row.Key, stored)
	if err != nil {
		return UserGroup{}, err
	}
	return UserGroup{
		Key:         row.Key,
		Name:        row.Name,
		Description: row.Description,
		Builtin:     row.Builtin,
		Editable:    row.Key == permission.GroupUser || row.Key == permission.GroupAdmin,
		Permissions: normalized,
		UpdatedAt:   row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano),
	}, nil
}
