package shortlink

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

func (s *Service) PreviewOwnNoteClear(ctx context.Context, actor auth.CurrentUser, input BatchNotePreviewInput) (BatchNotePreviewResult, error) {
	p, _, err := s.batchNoteClear(ctx, actor, previewNoteItems(input), false, false)
	return p, err
}

func (s *Service) PreviewAdminNoteClear(ctx context.Context, actor auth.CurrentUser, input BatchNotePreviewInput) (BatchNotePreviewResult, error) {
	p, _, err := s.batchNoteClear(ctx, actor, previewNoteItems(input), true, false)
	return p, err
}

func (s *Service) ClearOwnNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteClearInput) (BatchNoteClearResult, error) {
	_, r, err := s.batchNoteClear(ctx, actor, input.Items, false, true)
	return r, err
}

func (s *Service) ClearAdminNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteClearInput) (BatchNoteClearResult, error) {
	_, r, err := s.batchNoteClear(ctx, actor, input.Items, true, true)
	return r, err
}

type lockedBatchNote struct {
	id, owner  pgtype.UUID
	main, note pgtype.Timestamptz
	hasNote    bool
}

// batchNoteClear validates every locked resource before comparing revisions or writing any note.
func (s *Service) batchNoteClear(ctx context.Context, actor auth.CurrentUser, items []BatchNoteClearItem, admin, clear bool) (BatchNotePreviewResult, BatchNoteClearResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var preview BatchNotePreviewResult
	var result BatchNoteClearResult
	actorID, err := parseNoteID(actor.ID)
	if err != nil {
		return preview, result, ErrPermissionDenied
	}
	required := notePermissions(admin, true)
	if _, err = s.authorize(ctx, actor, required...); err != nil {
		return preview, result, err
	}
	ids, versions, err := normalizeBatchNoteItems(items, clear)
	if err != nil {
		return preview, result, err
	}
	transaction := func(tx pgx.Tx) error {
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
		for _, p := range required {
			if !grants.Has(p) {
				return ErrPermissionDenied
			}
		}
		var links []lockedBatchNote
		if clear {
			rows, err := q.LockBatchNoteClearTargets(ctx, ids)
			if err != nil {
				return err
			}
			for _, r := range rows {
				links = append(links, lockedBatchNote{r.ID, r.OwnerID, r.UpdatedAt, r.NoteUpdatedAt, r.HasNote})
			}
		} else {
			rows, err := q.LockBatchNoteClearPreview(ctx, ids)
			if err != nil {
				return err
			}
			for _, r := range rows {
				links = append(links, lockedBatchNote{r.ID, r.OwnerID, r.UpdatedAt, r.NoteUpdatedAt, r.HasNote})
			}
		}
		if len(links) != len(ids) {
			return ErrShortLinkMissing
		}
		for _, link := range links {
			if !admin && link.owner.Bytes != actorID {
				return ErrShortLinkMissing
			}
		}
		for _, link := range links {
			expected := versions[link.id.Bytes]
			if !link.main.Time.Equal(expected.main) || (clear && !link.note.Time.Equal(expected.note)) {
				return ErrTransferConflict
			}
		}
		if clear {
			for _, link := range links {
				if !link.hasNote {
					result.UnchangedCount++
					continue
				}
				if _, err := q.UpdateShortLinkNote(ctx, sqlc.UpdateShortLinkNoteParams{ID: link.id, Note: ""}); err != nil {
					return err
				}
				result.ChangedCount++
			}
			return nil
		}
		byID := make(map[uuid.UUID]lockedBatchNote, len(links))
		for _, link := range links {
			byID[link.id.Bytes] = link
		}
		preview.Items = make([]BatchNotePreviewResultItem, 0, len(items))
		for _, id := range ids {
			link := byID[id.Bytes]
			preview.Items = append(preview.Items, BatchNotePreviewResultItem{ID: uuid.UUID(link.id.Bytes).String(), ExpectedUpdatedAt: link.main.Time.UTC().Format(time.RFC3339Nano), ExpectedNoteUpdatedAt: link.note.Time.UTC().Format(time.RFC3339Nano), HasNote: link.hasNote})
			if link.hasNote {
				preview.NonemptyCount++
			} else {
				preview.EmptyCount++
			}
		}
		return nil
	}
	if clear {
		err = appdb.WithAuditTx(ctx, s.pool, actor.ID, transaction)
	} else {
		err = appdb.WithTx(ctx, s.pool, transaction)
	}
	if err != nil {
		return BatchNotePreviewResult{}, BatchNoteClearResult{}, err
	}
	return preview, result, nil
}
