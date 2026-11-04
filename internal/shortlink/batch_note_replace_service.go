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

func (s *Service) PreviewOwnNoteReplace(ctx context.Context, actor auth.CurrentUser, input BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error) {
	p, _, err := s.batchNoteReplace(ctx, actor, previewNoteItems(BatchNotePreviewInput{Items: input.Items}), input.Note, false, false)
	return p, err
}

func (s *Service) PreviewAdminNoteReplace(ctx context.Context, actor auth.CurrentUser, input BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error) {
	p, _, err := s.batchNoteReplace(ctx, actor, previewNoteItems(BatchNotePreviewInput{Items: input.Items}), input.Note, true, false)
	return p, err
}

func (s *Service) ReplaceOwnNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteReplaceInput) (BatchNoteClearResult, error) {
	_, r, err := s.batchNoteReplace(ctx, actor, input.Items, input.Note, false, true)
	return r, err
}

func (s *Service) ReplaceAdminNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteReplaceInput) (BatchNoteClearResult, error) {
	_, r, err := s.batchNoteReplace(ctx, actor, input.Items, input.Note, true, true)
	return r, err
}

type lockedBatchNoteReplacement struct {
	id, owner  pgtype.UUID
	main, note pgtype.Timestamptz
	willChange bool
}

// batchNoteReplace locks the entire batch and validates visibility and both revisions before changing notes.
func (s *Service) batchNoteReplace(ctx context.Context, actor auth.CurrentUser, items []BatchNoteClearItem, rawNote string, admin, write bool) (BatchNoteReplacePreviewResult, BatchNoteClearResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var preview BatchNoteReplacePreviewResult
	var result BatchNoteClearResult
	actorID, err := parseNoteID(actor.ID)
	if err != nil {
		return preview, result, ErrPermissionDenied
	}
	required := notePermissions(admin, true)
	if _, err = s.authorize(ctx, actor, required...); err != nil {
		return preview, result, err
	}
	note, err := normalizeNote(rawNote)
	if err != nil || note == "" {
		return preview, result, ErrInvalidInput
	}
	ids, versions, err := normalizeBatchNoteItems(items, write)
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
		var links []lockedBatchNoteReplacement
		if write {
			rows, err := q.LockBatchNoteReplaceTargets(ctx, sqlc.LockBatchNoteReplaceTargetsParams{Replacement: note, Ids: ids})
			if err != nil {
				return err
			}
			for _, r := range rows {
				links = append(links, lockedBatchNoteReplacement{r.ID, r.OwnerID, r.UpdatedAt, r.NoteUpdatedAt, r.WillChange})
			}
		} else {
			rows, err := q.LockBatchNoteReplacePreview(ctx, sqlc.LockBatchNoteReplacePreviewParams{Replacement: note, Ids: ids})
			if err != nil {
				return err
			}
			for _, r := range rows {
				links = append(links, lockedBatchNoteReplacement{r.ID, r.OwnerID, r.UpdatedAt, r.NoteUpdatedAt, r.WillChange})
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
			if !link.main.Time.Equal(expected.main) || (write && !link.note.Time.Equal(expected.note)) {
				return ErrTransferConflict
			}
		}
		if write {
			for _, link := range links {
				if !link.willChange {
					result.UnchangedCount++
					continue
				}
				if _, err := q.UpdateShortLinkNote(ctx, sqlc.UpdateShortLinkNoteParams{ID: link.id, Note: note}); err != nil {
					return err
				}
				result.ChangedCount++
			}
			return nil
		}
		byID := make(map[uuid.UUID]lockedBatchNoteReplacement, len(links))
		for _, link := range links {
			byID[link.id.Bytes] = link
		}
		preview.Items = make([]BatchNoteReplacePreviewResultItem, 0, len(items))
		for _, id := range ids {
			link := byID[id.Bytes]
			preview.Items = append(preview.Items, BatchNoteReplacePreviewResultItem{ID: uuid.UUID(link.id.Bytes).String(), ExpectedUpdatedAt: link.main.Time.UTC().Format(time.RFC3339Nano), ExpectedNoteUpdatedAt: link.note.Time.UTC().Format(time.RFC3339Nano), WillChange: link.willChange})
			if link.willChange {
				preview.ChangedCount++
			} else {
				preview.UnchangedCount++
			}
		}
		return nil
	}
	if write {
		err = appdb.WithAuditTx(ctx, s.pool, actor.ID, transaction)
	} else {
		err = appdb.WithTx(ctx, s.pool, transaction)
	}
	if err != nil {
		return BatchNoteReplacePreviewResult{}, BatchNoteClearResult{}, err
	}
	return preview, result, nil
}
