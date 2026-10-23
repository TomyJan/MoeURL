package user

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// ChangeGroup atomically reauthorizes a managed account change, revokes sessions and records its audit.
func (s *Service) ChangeGroup(ctx context.Context, actor auth.CurrentUser, input ChangeGroupInput) (UpdateResult, error) {
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return UpdateResult{}, ErrPermissionDenied
	}
	id, err := uuid.Parse(input.ID)
	expected, timeErr := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || id == uuid.Nil || id.String() != input.ID || timeErr != nil || expected.IsZero() || (input.GroupKey != "user" && input.GroupKey != "admin") {
		return UpdateResult{}, ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result UpdateResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		rows, err := q.LockGroupChangeUsers(ctx, []pgtype.UUID{uuidToPgtype(actorID), uuidToPgtype(id)})
		if err != nil {
			return err
		}
		var current, target *sqlc.AppUser
		for i := range rows {
			if rows[i].ID.Bytes == actorID {
				current = &rows[i]
			}
			if rows[i].ID.Bytes == id {
				target = &rows[i]
			}
		}
		if current == nil || current.Status != "active" || current.DeletedAt.Valid {
			return ErrPermissionDenied
		}
		// The row lock stabilizes the actor's primary group; share-lock its permissions before authorizing.
		actorGroup, err := q.GetUserGroupByID(ctx, current.GroupID)
		if err != nil {
			return err
		}
		actorGroup, err = q.GetGroupChangeGroup(ctx, actorGroup.Key)
		if err != nil {
			return err
		}
		grants, err := permission.DecodeSnapshot(actorGroup.Permissions)
		if err != nil {
			return err
		}
		if actorGroup.Key == "guest" || !grants.Has(permission.AdminAccess) {
			return ErrPermissionDenied
		}
		if target == nil || target.DeletedAt.Valid {
			return ErrUserNotFound
		}
		if target.Builtin {
			return ErrBuiltinUserImmutable
		}
		if id == actorID {
			return ErrSelfGroupChange
		}
		if !target.UpdatedAt.Time.Equal(expected) {
			return ErrVersionConflict
		}
		group, err := q.GetUserGroupByKey(ctx, input.GroupKey)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidInput
		}
		if err != nil {
			return err
		}
		if !group.Builtin {
			return ErrInvalidInput
		}
		updated := *target
		if target.GroupID != group.ID {
			updated, err = q.ChangeAppUserGroup(ctx, sqlc.ChangeAppUserGroupParams{ID: target.ID, GroupID: group.ID})
			if err != nil {
				return err
			}
			if err = q.RevokeGroupChangeSessions(ctx, target.ID); err != nil {
				return err
			}
		}
		result = UpdateResult{User: UserSummary{ID: input.ID, Username: updated.Username, Nickname: updated.Nickname, Group: group.Key, Status: updated.Status, Builtin: updated.Builtin, CreatedAt: formatTime(updated.CreatedAt), UpdatedAt: formatTime(updated.UpdatedAt)}}
		return nil
	})
	return result, err
}
