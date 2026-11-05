package shortlink

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

// RenameOwnTags atomically renames a tag on the actor's current links.
func (s *Service) RenameOwnTags(ctx context.Context, actor auth.CurrentUser, input BatchTagRenameInput) (BatchTagsResult, error) {
	return s.renameTags(ctx, actor, input, false)
}

// RenameAdminTags atomically renames a tag across owners with current administrator grants.
func (s *Service) RenameAdminTags(ctx context.Context, actor auth.CurrentUser, input BatchTagRenameInput) (BatchTagsResult, error) {
	return s.renameTags(ctx, actor, input, true)
}

// renameTags validates the whole locked batch, including no-ops, before any audited write.
func (s *Service) renameTags(ctx context.Context, actor auth.CurrentUser, input BatchTagRenameInput, admin bool) (BatchTagsResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	required := []string{permission.ShortLinkUpdateOwn, permission.ShortLinkSetMetadata}
	if admin {
		required = []string{permission.AdminAccess, permission.ShortLinkUpdateAll, permission.ShortLinkSetMetadata}
	}
	if _, err := s.authorize(ctx, actor, required...); err != nil {
		return BatchTagsResult{}, err
	}
	actorID, err := parseNoteID(actor.ID)
	if err != nil {
		return BatchTagsResult{}, ErrPermissionDenied
	}
	ids, versions, from, to, err := normalizeBatchTagRename(input)
	if err != nil {
		return BatchTagsResult{}, err
	}
	var result BatchTagsResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		current, err := q.LockBatchTagsActor(ctx, uuidToPgtype(actorID))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if current.Status != "active" || current.DeletedAt.Valid {
			return ErrPermissionDenied
		}
		group, err := q.LockTransferActorGroup(ctx, current.GroupID)
		if err != nil {
			return err
		}
		grants, err := permission.DecodeSnapshot(group.Permissions)
		if err != nil {
			return err
		}
		if group.Key == permission.GroupGuest {
			return ErrPermissionDenied
		}
		for _, capability := range required {
			if !grants.Has(capability) {
				return ErrPermissionDenied
			}
		}
		links, err := q.LockBatchTagsShortLinks(ctx, ids)
		if err != nil {
			return err
		}
		if len(links) != len(ids) {
			return ErrShortLinkMissing
		}
		updated := make([][]string, len(links))
		for i, link := range links {
			if !admin && link.OwnerID.Bytes != actorID {
				return ErrShortLinkMissing
			}
			if !link.UpdatedAt.Time.Equal(versions[link.ID.Bytes]) {
				return ErrTransferConflict
			}
			updated[i] = renameBatchTag(link.Tags, from, to)
		}
		for i, link := range links {
			if slices.Equal(link.Tags, updated[i]) {
				result.UnchangedCount++
				continue
			}
			if err := q.UpdateBatchTags(ctx, sqlc.UpdateBatchTagsParams{ID: link.ID, Tags: updated[i]}); err != nil {
				return err
			}
			result.ChangedCount++
		}
		return nil
	})
	if err != nil {
		return BatchTagsResult{}, err
	}
	return result, nil
}
