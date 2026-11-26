package user

import (
	"context"
	"errors"
	"sort"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// UpdateGroupMemberships atomically replaces the complete supplemental-group set for one account.
func (s *Service) UpdateGroupMemberships(ctx context.Context, actor auth.CurrentUser, input UpdateGroupMembershipsInput) (UpdateResult, error) {
	actorID, err := parseCanonicalUserID(actor.ID)
	if err != nil {
		return UpdateResult{}, ErrPermissionDenied
	}
	targetID, err := parseCanonicalUserID(input.ID)
	if err != nil || input.GroupKeys == nil || input.ExpectedUpdatedAt == "" {
		return UpdateResult{}, ErrInvalidInput
	}
	expected, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || expected.IsZero() || !batchGroupTimestamp.MatchString(input.ExpectedUpdatedAt) {
		return UpdateResult{}, ErrInvalidInput
	}
	groupKeys, err := normalizeSupplementalGroupKeys(input.GroupKeys)
	if err != nil {
		return UpdateResult{}, ErrInvalidInput
	}

	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result UpdateResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		rows, err := q.LockGroupChangeUsers(ctx, []pgtype.UUID{uuidToPgtype(actorID), uuidToPgtype(targetID)})
		if err != nil {
			return err
		}
		var current, target *sqlc.AppUser
		for i := range rows {
			if rows[i].ID.Bytes == actorID {
				current = &rows[i]
			}
			if rows[i].ID.Bytes == targetID {
				target = &rows[i]
			}
		}
		if current == nil || current.Status != "active" || current.DeletedAt.Valid || current.Builtin {
			return ErrPermissionDenied
		}
		actorGroup, err := q.GetUserGroupByID(ctx, current.GroupID)
		if err != nil {
			return err
		}
		actorGroup, err = q.LockGroupChangeGroup(ctx, actorGroup.Key)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		grants, err := permission.DecodeSnapshot(actorGroup.Permissions)
		if err != nil {
			return err
		}
		if !actorGroup.Builtin || actorGroup.Key != permission.GroupAdmin || !grants.Has(permission.AdminAccess) {
			return ErrPermissionDenied
		}
		if target == nil || target.DeletedAt.Valid {
			return ErrUserNotFound
		}
		if target.Builtin {
			return ErrBuiltinUserImmutable
		}
		if targetID == actorID {
			return ErrSelfGroupChange
		}
		if !target.UpdatedAt.Time.Equal(expected) {
			return ErrVersionConflict
		}
		primary, err := q.GetUserGroupByID(ctx, target.GroupID)
		if err != nil {
			return err
		}
		groups := make([]sqlc.UserGroup, 0, len(groupKeys))
		for _, key := range groupKeys {
			group, err := q.LockUserGroupForCustomManagement(ctx, key)
			if errors.Is(err, pgx.ErrNoRows) || (err == nil && !isAssignableGroup(group.Key, group.Builtin)) {
				return ErrInvalidInput
			}
			if err != nil {
				return err
			}
			if _, err := permission.DecodeGroupSnapshot(group.Key, group.Builtin, group.Permissions); err != nil {
				return err
			}
			if group.ID == target.GroupID {
				return ErrInvalidInput
			}
			groups = append(groups, group)
		}
		currentGroups, err := q.GetSupplementalUserGroupsByID(ctx, uuidToPgtype(targetID))
		if err != nil {
			return err
		}
		if supplementalGroupKeysEqual(currentGroups, groupKeys) {
			result = UpdateResult{User: userSummaryWithSupplementalGroups(*target, primary.Key, membershipsFromRows(currentGroups))}
			return nil
		}

		if err := q.DeleteSupplementalUserGroupMembershipsByUserID(ctx, uuidToPgtype(targetID)); err != nil {
			return err
		}
		for _, group := range groups {
			if err := q.CreateSupplementalUserGroupMembership(ctx, sqlc.CreateSupplementalUserGroupMembershipParams{
				UserID: target.ID, UserGroupID: group.ID,
			}); err != nil {
				return err
			}
		}
		updated, err := q.UpdateAppUserMembershipRevision(ctx, sqlc.UpdateAppUserMembershipRevisionParams{
			ID: target.ID, ExpectedUpdatedAt: target.UpdatedAt,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrVersionConflict
		}
		if err != nil {
			return err
		}
		if err := q.RevokeGroupChangeSessions(ctx, target.ID); err != nil {
			return err
		}
		if err := q.CreateUserGroupMembershipAudit(ctx, sqlc.CreateUserGroupMembershipAuditParams{
			ActorID: pgtype.UUID{Bytes: actorID, Valid: true}, ResourceID: input.ID,
		}); err != nil {
			return err
		}
		memberships := make([]GroupMembership, 0, len(groups))
		for _, group := range groups {
			memberships = append(memberships, GroupMembership{Key: group.Key, Name: group.Name})
		}
		result = UpdateResult{User: userSummaryWithSupplementalGroups(updated, primary.Key, memberships)}
		return nil
	})
	return result, err
}

func parseCanonicalUserID(value string) (uuid.UUID, error) {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil || id.String() != value {
		return uuid.Nil, ErrInvalidInput
	}
	return id, nil
}

func normalizeSupplementalGroupKeys(values []string) ([]string, error) {
	if values == nil {
		return nil, ErrInvalidInput
	}
	keys := append([]string(nil), values...)
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		id, err := uuid.Parse(key)
		if err != nil || id == uuid.Nil || id.String() != key {
			return nil, ErrInvalidInput
		}
		if _, duplicate := seen[key]; duplicate {
			return nil, ErrInvalidInput
		}
		seen[key] = struct{}{}
	}
	sort.Strings(keys)
	return keys, nil
}

func supplementalGroupKeysEqual(current []sqlc.GetSupplementalUserGroupsByIDRow, requested []string) bool {
	if len(current) != len(requested) {
		return false
	}
	for i := range current {
		if current[i].Key != requested[i] {
			return false
		}
	}
	return true
}

func membershipsFromRows(rows []sqlc.GetSupplementalUserGroupsByIDRow) []GroupMembership {
	memberships := make([]GroupMembership, 0, len(rows))
	for _, row := range rows {
		memberships = append(memberships, GroupMembership{Key: row.Key, Name: row.Name})
	}
	return memberships
}

func userSummaryWithSupplementalGroups(row sqlc.AppUser, primaryKey string, groups []GroupMembership) UserSummary {
	if groups == nil {
		groups = []GroupMembership{}
	}
	return UserSummary{
		ID: uuidFromPgtype(row.ID), Username: row.Username, Nickname: row.Nickname, Group: primaryKey,
		SupplementalGroups: groups, Status: row.Status, Builtin: row.Builtin,
		CreatedAt: formatTime(row.CreatedAt), UpdatedAt: formatTime(row.UpdatedAt),
	}
}
