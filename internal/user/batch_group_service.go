package user

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var batchGroupTimestamp = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-]([01][0-9]|2[0-3]):[0-5][0-9])$`)

// BatchChangeGroup preflights the entire locked set, then commits membership, session revocation and audit together.
func (s *Service) BatchChangeGroup(ctx context.Context, actor auth.CurrentUser, input BatchChangeGroupInput) (BatchChangeGroupResult, error) {
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return BatchChangeGroupResult{}, ErrPermissionDenied
	}
	if len(input.Items) < 1 || len(input.Items) > 100 || (input.GroupKey != "user" && input.GroupKey != "admin") {
		return BatchChangeGroupResult{}, ErrInvalidInput
	}
	versions := make(map[uuid.UUID]time.Time, len(input.Items))
	ids := []pgtype.UUID{uuidToPgtype(actorID)}
	for _, item := range input.Items {
		id, idErr := uuid.Parse(item.ID)
		expected, timeErr := time.Parse(time.RFC3339Nano, item.ExpectedUpdatedAt)
		if idErr != nil || id == uuid.Nil || id.String() != item.ID || !batchGroupTimestamp.MatchString(item.ExpectedUpdatedAt) || timeErr != nil || expected.IsZero() {
			return BatchChangeGroupResult{}, ErrInvalidInput
		}
		if _, duplicate := versions[id]; duplicate {
			return BatchChangeGroupResult{}, ErrInvalidInput
		}
		versions[id] = expected
		ids = append(ids, uuidToPgtype(id))
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result BatchChangeGroupResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		rows, err := q.LockGroupChangeUsers(ctx, ids)
		if err != nil {
			return err
		}
		var current *sqlc.AppUser
		targets := make([]sqlc.AppUser, 0, len(versions))
		for i := range rows {
			if rows[i].ID.Bytes == actorID {
				current = &rows[i]
			}
			if _, selected := versions[rows[i].ID.Bytes]; selected {
				targets = append(targets, rows[i])
			}
		}
		if current == nil || current.DeletedAt.Valid || current.Status != "active" || current.Builtin {
			return ErrPermissionDenied
		}
		admin, err := q.GetGroupChangeGroup(ctx, "admin")
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !admin.Builtin) {
			return ErrInvalidInput
		}
		if err != nil {
			return err
		}
		if current.GroupID != admin.ID {
			return ErrPermissionDenied
		}
		grants, err := permission.DecodeSnapshot(admin.Permissions)
		if err != nil {
			return err
		}
		if !grants.Has(permission.AdminAccess) {
			return ErrPermissionDenied
		}
		regular, err := q.GetGroupChangeGroup(ctx, "user")
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !regular.Builtin) {
			return ErrInvalidInput
		}
		if err != nil {
			return err
		}
		// Separate category passes make mixed-error precedence independent of both request and UUID order.
		if len(targets) != len(versions) {
			return ErrUserNotFound
		}
		for _, target := range targets {
			if target.DeletedAt.Valid {
				return ErrUserNotFound
			}
		}
		for _, target := range targets {
			if target.Builtin {
				return ErrBuiltinUserImmutable
			}
		}
		if _, self := versions[actorID]; self {
			return ErrSelfGroupChange
		}
		for _, target := range targets {
			if target.GroupID != admin.ID && target.GroupID != regular.ID {
				return ErrInvalidInput
			}
		}
		for _, target := range targets {
			if !target.UpdatedAt.Time.Equal(versions[target.ID.Bytes]) {
				return ErrVersionConflict
			}
		}
		destination := regular.ID
		if input.GroupKey == "admin" {
			destination = admin.ID
		}
		for _, target := range targets {
			if target.GroupID == destination {
				result.UnchangedCount++
				continue
			}
			if _, err := q.ChangeAppUserGroup(ctx, sqlc.ChangeAppUserGroupParams{ID: target.ID, GroupID: destination}); err != nil {
				return err
			}
			if err := q.RevokeGroupChangeSessions(ctx, target.ID); err != nil {
				return err
			}
			result.ChangedCount++
		}
		return nil
	})
	if err != nil {
		return BatchChangeGroupResult{}, err
	}
	return result, nil
}
