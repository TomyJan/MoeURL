package shortlink

import (
	"context"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchInput selects one bounded set of links and one explicit management action.
type BatchInput struct {
	IDs    []string `json:"ids"`
	Action string   `json:"action"`
}

// BatchResult reports the number of matched records after an atomic write.
type BatchResult struct {
	AffectedCount int64 `json:"affectedCount"`
}

// Batch atomically enables, disables or soft-deletes links owned by the caller.
func (s *Service) Batch(ctx context.Context, actor auth.CurrentUser, input BatchInput) (BatchResult, error) {
	return s.batch(ctx, actor, input, false)
}

// AdminBatch atomically manages links with administrative and action-specific permissions.
func (s *Service) AdminBatch(ctx context.Context, actor auth.CurrentUser, input BatchInput) (BatchResult, error) {
	return s.batch(ctx, actor, input, true)
}

// batch validates the request and applies one SQL statement with current database authorization.
func (s *Service) batch(ctx context.Context, actor auth.CurrentUser, input BatchInput, admin bool) (BatchResult, error) {
	ids, err := normalizeBatch(input)
	if err != nil {
		return BatchResult{}, err
	}
	required := permission.ShortLinkUpdateOwn
	if input.Action == "delete" {
		required = permission.ShortLinkDeleteOwn
	}
	if admin {
		required = permission.ShortLinkUpdateAll
		if input.Action == "delete" {
			required = permission.ShortLinkDeleteAll
		}
		_, err = s.authorizeAdmin(ctx, actor, required)
	} else {
		_, err = s.authorize(ctx, actor, required)
	}
	if err != nil {
		return BatchResult{}, err
	}
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil {
		return BatchResult{}, ErrInvalidInput
	}
	requiredPermissions := []string{required}
	if admin {
		requiredPermissions = append(requiredPermissions, permission.AdminAccess)
	}
	var authorized bool
	var affected int64
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		queries := s.queries.WithTx(tx)
		if input.Action == "delete" {
			row, queryErr := queries.BatchDeleteShortLinks(ctx, sqlc.BatchDeleteShortLinksParams{
				ActorID: uuidToPgtype(actorID), GroupKey: actor.GroupKey, RequiredPermissions: requiredPermissions, Ids: ids, AdminScope: admin,
			})
			authorized, affected, err = row.Authorized, row.AffectedCount, queryErr
		} else {
			status := "active"
			if input.Action == "disable" {
				status = "disabled"
			}
			row, queryErr := queries.BatchSetShortLinkStatus(ctx, sqlc.BatchSetShortLinkStatusParams{
				ActorID: uuidToPgtype(actorID), GroupKey: actor.GroupKey, RequiredPermissions: requiredPermissions, Ids: ids, AdminScope: admin, Status: status,
			})
			authorized, affected, err = row.Authorized, row.AffectedCount, queryErr
		}
		return err
	})
	if err != nil {
		return BatchResult{}, err
	}
	if !authorized {
		return BatchResult{}, ErrPermissionDenied
	}
	if affected != int64(len(ids)) {
		return BatchResult{}, ErrShortLinkMissing
	}
	return BatchResult{AffectedCount: affected}, nil
}

// normalizeBatch rejects unsupported actions, invalid bounds and equivalent UUID duplicates.
func normalizeBatch(input BatchInput) ([]pgtype.UUID, error) {
	if input.Action != "enable" && input.Action != "disable" && input.Action != "delete" {
		return nil, ErrInvalidInput
	}
	if len(input.IDs) < 1 || len(input.IDs) > 100 {
		return nil, ErrInvalidInput
	}
	ids := make([]pgtype.UUID, 0, len(input.IDs))
	seen := make(map[uuid.UUID]bool, len(input.IDs))
	for _, raw := range input.IDs {
		id, err := uuid.Parse(raw)
		if err != nil || id == uuid.Nil || seen[id] {
			return nil, ErrInvalidInput
		}
		seen[id] = true
		ids = append(ids, uuidToPgtype(id))
	}
	return ids, nil
}
