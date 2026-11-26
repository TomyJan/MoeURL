package permission

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Resolver returns one immutable permission snapshot for a user group.
type Resolver interface {
	Resolve(context.Context, string) (Snapshot, error)
}

type accountResolver interface {
	ResolveAccount(context.Context, string) (Snapshot, error)
}

type accountTransactionResolver interface {
	ResolveAccountIn(context.Context, sqlc.DBTX, string) (Snapshot, error)
}

type lockedAccountTransactionResolver interface {
	ResolveAccountLockedIn(context.Context, sqlc.DBTX, string) (Snapshot, error)
}

// ResolveForAccount uses live membership for database resolvers. Static group resolution exists
// solely for isolated service tests and must not be used as a production authorization source.
func ResolveForAccount(ctx context.Context, resolver Resolver, userID, fallbackGroupKey string) (Snapshot, error) {
	if fallbackGroupKey == GroupGuest {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	if current, ok := resolver.(accountResolver); ok {
		return current.ResolveAccount(ctx, userID)
	}
	return resolver.Resolve(ctx, fallbackGroupKey)
}

// ResolveForAccountIn resolves an account snapshot within the caller's transaction when possible.
func ResolveForAccountIn(ctx context.Context, database sqlc.DBTX, resolver Resolver, userID, fallbackGroupKey string) (Snapshot, error) {
	if fallbackGroupKey == GroupGuest {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	if current, ok := resolver.(accountTransactionResolver); ok {
		return current.ResolveAccountIn(ctx, database, userID)
	}
	return ResolveForAccount(ctx, resolver, userID, fallbackGroupKey)
}

// ResolveForAccountLockedIn is for mutation paths after the actor row has been locked.
func ResolveForAccountLockedIn(ctx context.Context, database sqlc.DBTX, resolver Resolver, userID, fallbackGroupKey string) (Snapshot, error) {
	if fallbackGroupKey == GroupGuest {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	if current, ok := resolver.(lockedAccountTransactionResolver); ok {
		return current.ResolveAccountLockedIn(ctx, database, userID)
	}
	return ResolveForAccountIn(ctx, database, resolver, userID, fallbackGroupKey)
}

// Snapshot is the permission set used throughout one business operation.
type Snapshot struct {
	permissions map[string]struct{}
	groupKeys   []string
}

// Has reports whether the snapshot grants a permission.
func (s Snapshot) Has(permission string) bool {
	_, ok := s.permissions[permission]
	return ok
}

// GroupKeys returns a stable, detached list of the groups represented in this snapshot.
func (s Snapshot) GroupKeys() []string {
	result := append([]string(nil), s.groupKeys...)
	slices.Sort(result)
	return result
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
	return Snapshot{permissions: cloneSet(s.permissionsByGroup[groupKey]), groupKeys: []string{groupKey}}, nil
}

// DatabaseService resolves current group permissions directly from PostgreSQL.
type DatabaseService struct {
	queries  groupQueries
	database sqlc.DBTX
}

type groupQueries interface {
	GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error)
}

// NewDatabaseService creates a permission resolver without a cross-request cache.
func NewDatabaseService(pool *pgxpool.Pool) *DatabaseService {
	if pool == nil {
		return &DatabaseService{}
	}
	return &DatabaseService{queries: sqlc.New(pool), database: pool}
}

// ResolveAccount resolves the active persisted account's primary and supplemental permissions.
// The returned snapshot is an immutable, operation-local union and is never cached.
func (s *DatabaseService) ResolveAccount(ctx context.Context, userID string) (Snapshot, error) {
	return resolveAccount(ctx, s.database, userID)
}

// ResolveAccountIn resolves current account permissions using the caller's database transaction.
func (s *DatabaseService) ResolveAccountIn(ctx context.Context, database sqlc.DBTX, userID string) (Snapshot, error) {
	if database == nil {
		return Snapshot{}, errors.New("account permission database is unavailable")
	}
	return resolveAccount(ctx, database, userID)
}

// ResolveAccountLockedIn waits for and holds share locks on every current account group before
// reading permissions. Mutation callers must lock the actor row first to serialize memberships.
func (s *DatabaseService) ResolveAccountLockedIn(ctx context.Context, database sqlc.DBTX, userID string) (Snapshot, error) {
	if database == nil {
		return Snapshot{}, errors.New("account permission database is unavailable")
	}
	if _, err := uuid.Parse(userID); err != nil {
		return Snapshot{}, fmt.Errorf("invalid account ID: %w", err)
	}
	var expected int
	if err := database.QueryRow(ctx, `
		select count(*) from (
			select group_id as id from app_user where id=$1::uuid
			union select user_group_id as id from app_user_group_membership where user_id=$1::uuid
		) as current_groups
	`, userID).Scan(&expected); err != nil {
		return Snapshot{}, err
	}
	rows, err := database.Query(ctx, `
		select g.id from user_group as g
		join (
			select group_id as id from app_user where id=$1::uuid
			union select user_group_id as id from app_user_group_membership where user_id=$1::uuid
		) as current_groups on current_groups.id=g.id
		order by g.id for share of g
	`, userID)
	if err != nil {
		return Snapshot{}, err
	}
	locked := 0
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return Snapshot{}, err
		}
		locked++
	}
	rowsErr := rows.Err()
	rows.Close()
	if rowsErr != nil {
		return Snapshot{}, rowsErr
	}
	if locked != expected {
		return Snapshot{}, errors.New("one or more account groups are missing")
	}
	return resolveAccount(ctx, database, userID)
}

func resolveAccount(ctx context.Context, database sqlc.DBTX, userID string) (Snapshot, error) {
	if database == nil {
		return Snapshot{}, errors.New("account permission database is unavailable")
	}
	if _, err := uuid.Parse(userID); err != nil {
		return Snapshot{}, fmt.Errorf("invalid account ID: %w", err)
	}
	rows, err := database.Query(ctx, `-- name: ResolveAccountPermissions
		select u.status, (u.deleted_at is not null), u.builtin,
		       primary_group.key, primary_group.builtin, primary_group.permissions,
		       (membership.user_group_id is not null), supplemental_group.key, supplemental_group.builtin, supplemental_group.permissions
		from app_user as u
		left join user_group as primary_group on primary_group.id = u.group_id
		left join app_user_group_membership as membership on membership.user_id = u.id
		left join user_group as supplemental_group on supplemental_group.id = membership.user_group_id
		where u.id = $1::uuid
		order by supplemental_group.key
	`, userID)
	if err != nil {
		return Snapshot{}, err
	}
	defer rows.Close()
	var permissions map[string]struct{}
	var groupKeys []string
	var found bool
	for rows.Next() {
		var status string
		var deleted, accountBuiltin bool
		var primaryKey, supplementalKey *string
		var primaryBuiltin, supplementalBuiltin *bool
		var primaryPermissions, supplementalPermissions []byte
		var hasSupplementalRelation bool
		if err := rows.Scan(&status, &deleted, &accountBuiltin, &primaryKey, &primaryBuiltin, &primaryPermissions, &hasSupplementalRelation, &supplementalKey, &supplementalBuiltin, &supplementalPermissions); err != nil {
			return Snapshot{}, err
		}
		if !found {
			found = true
			if primaryKey == nil || primaryBuiltin == nil {
				return Snapshot{}, errors.New("account primary group is missing")
			}
			if status != "active" || deleted || accountBuiltin || *primaryKey == GroupGuest {
				return Snapshot{permissions: toSet(nil)}, nil
			}
			primary, err := DecodeGroupSnapshot(*primaryKey, *primaryBuiltin, primaryPermissions)
			if err != nil {
				return Snapshot{}, fmt.Errorf("invalid primary group permissions: %w", err)
			}
			permissions = cloneSet(primary.permissions)
			groupKeys = append(groupKeys, *primaryKey)
		}
		if hasSupplementalRelation && supplementalKey == nil {
			return Snapshot{}, errors.New("supplemental group relation references a missing group")
		}
		if supplementalKey == nil {
			continue
		}
		if supplementalBuiltin == nil || *supplementalBuiltin || *supplementalKey == GroupGuest || *supplementalKey == GroupUser || *supplementalKey == GroupAdmin {
			return Snapshot{}, errors.New("invalid supplemental group")
		}
		if _, err := uuid.Parse(*supplementalKey); err != nil {
			return Snapshot{}, fmt.Errorf("invalid supplemental group key: %w", err)
		}
		supplemental, err := DecodeGroupSnapshot(*supplementalKey, false, supplementalPermissions)
		if err != nil {
			return Snapshot{}, fmt.Errorf("invalid supplemental group permissions: %w", err)
		}
		for key := range supplemental.permissions {
			permissions[key] = struct{}{}
		}
		groupKeys = append(groupKeys, *supplementalKey)
	}
	if err := rows.Err(); err != nil {
		return Snapshot{}, err
	}
	if !found {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	return Snapshot{permissions: permissions, groupKeys: groupKeys}, nil
}

func cloneSet(values map[string]struct{}) map[string]struct{} {
	result := make(map[string]struct{}, len(values))
	for value := range values {
		result[value] = struct{}{}
	}
	return result
}

// ResolveIn reads permissions using the caller's transaction snapshot.
func (s *DatabaseService) ResolveIn(ctx context.Context, database sqlc.DBTX, groupKey string) (Snapshot, error) {
	if database == nil {
		return Snapshot{}, errors.New("permission database is unavailable")
	}
	return (&DatabaseService{queries: sqlc.New(database)}).Resolve(ctx, groupKey)
}

// Resolve reads the current database permission set for a group.
func (s *DatabaseService) Resolve(ctx context.Context, groupKey string) (Snapshot, error) {
	if s == nil || s.queries == nil {
		return Snapshot{}, errors.New("permission database is unavailable")
	}
	group, err := s.queries.GetUserGroupByKey(ctx, groupKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return Snapshot{permissions: toSet(nil)}, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	return DecodeGroupSnapshot(group.Key, group.Builtin, group.Permissions)
}

// DecodeGroupSnapshot validates stored permissions against the immutable builtin/custom-group boundary.
func DecodeGroupSnapshot(groupKey string, builtin bool, data []byte) (Snapshot, error) {
	data = bytes.TrimSpace(data)
	if len(data) == 0 || data[0] != '[' {
		return Snapshot{}, errors.New("invalid stored group permission array")
	}
	var stored []string
	if err := json.Unmarshal(data, &stored); err != nil {
		return Snapshot{}, err
	}
	var normalized []string
	var err error
	if builtin {
		normalized, err = NormalizeForGroup(groupKey, stored)
	} else if groupKey == GroupGuest || groupKey == GroupUser || groupKey == GroupAdmin {
		return Snapshot{}, ErrUnknownGroup
	} else {
		normalized, err = NormalizeCustomGroup(stored)
	}
	if err != nil {
		return Snapshot{}, err
	}
	return Snapshot{permissions: toSet(normalized)}, nil
}

// DecodeSnapshot validates stored group permissions and returns an immutable lookup.
func DecodeSnapshot(data []byte) (Snapshot, error) {
	var permissions []string
	if err := json.Unmarshal(data, &permissions); err != nil {
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
