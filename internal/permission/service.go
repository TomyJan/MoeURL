package permission

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver returns one immutable permission snapshot for a user group.
type Resolver interface {
	Resolve(context.Context, string) (Snapshot, error)
}

// Snapshot is the permission set used throughout one business operation.
type Snapshot struct {
	permissions map[string]struct{}
}

// Has reports whether the snapshot grants a permission.
func (s Snapshot) Has(permission string) bool {
	_, ok := s.permissions[permission]
	return ok
}

type Service struct {
	permissionsByGroup map[string]map[string]struct{}
}

// NewService creates the permission lookup service.
func NewService() *Service {
	return NewServiceWithPermissions(UserPermissions, AdminPermissions)
}

// NewServiceWithPermissions creates a permission lookup service from isolated user and admin sets.
func NewServiceWithPermissions(userPermissions []string, adminPermissions []string) *Service {
	return &Service{
		permissionsByGroup: map[string]map[string]struct{}{
			GroupGuest: toSet(nil),
			GroupUser:  toSet(userPermissions),
			GroupAdmin: toSet(adminPermissions),
		},
	}
}

// Has reports whether a group grants a permission.
func (s *Service) Has(groupKey string, permission string) bool {
	permissions, ok := s.permissionsByGroup[groupKey]
	if !ok {
		return false
	}
	_, ok = permissions[permission]
	return ok
}

// Resolve returns the configured static permissions for a group.
func (s *Service) Resolve(_ context.Context, groupKey string) (Snapshot, error) {
	return Snapshot{permissions: s.permissionsByGroup[groupKey]}, nil
}

// DatabaseService resolves current group permissions directly from PostgreSQL.
type DatabaseService struct {
	queries groupQueries
}

type groupQueries interface {
	GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error)
}

// NewDatabaseService creates a permission resolver without a cross-request cache.
func NewDatabaseService(pool *pgxpool.Pool) *DatabaseService {
	return &DatabaseService{queries: sqlc.New(pool)}
}

// Resolve reads the current database permission set for a group.
func (s *DatabaseService) Resolve(ctx context.Context, groupKey string) (Snapshot, error) {
	group, err := s.queries.GetUserGroupByKey(ctx, groupKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	var permissions []string
	if err := json.Unmarshal(group.Permissions, &permissions); err != nil {
		return Snapshot{}, err
	}
	return Snapshot{permissions: toSet(permissions)}, nil
}

// toSet converts permission names into a lookup set.
func toSet(values []string) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for _, value := range values {
		result[value] = struct{}{}
	}
	return result
}
