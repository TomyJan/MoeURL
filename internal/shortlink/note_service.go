package shortlink

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
)

// ReadOwnNote reads a note only from a currently owned, live link.
func (s *Service) ReadOwnNote(ctx context.Context, actor auth.CurrentUser, id string) (NoteResult, error) {
	return s.readNote(ctx, actor, id, false)
}

// ReadAdminNote reads a live link after current global read authorization.
func (s *Service) ReadAdminNote(ctx context.Context, actor auth.CurrentUser, id string) (NoteResult, error) {
	return s.readNote(ctx, actor, id, true)
}

// UpdateOwnNote replaces a currently owned note and atomically records its field name.
func (s *Service) UpdateOwnNote(ctx context.Context, actor auth.CurrentUser, input NoteInput) (NoteResult, error) {
	return s.updateNote(ctx, actor, input, false)
}

// UpdateAdminNote replaces a note under current global read and write authorization.
func (s *Service) UpdateAdminNote(ctx context.Context, actor auth.CurrentUser, input NoteInput) (NoteResult, error) {
	return s.updateNote(ctx, actor, input, true)
}

// notePermissions keeps read and write capabilities explicit for each fixed scope.
func notePermissions(admin, write bool) []string {
	required := []string{permission.ShortLinkReadOwn}
	if admin {
		required = []string{permission.AdminAccess, permission.ShortLinkReadAll}
	}
	if write {
		if admin {
			required = append(required, permission.ShortLinkUpdateAll)
		} else {
			required = append(required, permission.ShortLinkUpdateOwn)
		}
		required = append(required, permission.ShortLinkSetMetadata)
	}
	return required
}

// readNote uses one SQL snapshot for current account, grants, owner and note text.
func (s *Service) readNote(ctx context.Context, actor auth.CurrentUser, rawID string, admin bool) (NoteResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	actorID, err := parseNoteID(actor.ID)
	if err != nil {
		return NoteResult{}, ErrPermissionDenied
	}
	if _, err = s.authorize(ctx, actor, notePermissions(admin, false)...); err != nil {
		return NoteResult{}, err
	}
	id, err := parseNoteID(rawID)
	if err != nil {
		return NoteResult{}, err
	}
	row, err := s.queries.ReadShortLinkNote(ctx, sqlc.ReadShortLinkNoteParams{ActorID: uuidToPgtype(actorID), AdminScope: admin, LinkID: uuidToPgtype(id)})
	if err != nil {
		return NoteResult{}, err
	}
	if !row.Allowed {
		return NoteResult{}, ErrPermissionDenied
	}
	if !row.Found {
		return NoteResult{}, ErrShortLinkMissing
	}
	return NoteResult{ID: row.ID, Note: row.Note, UpdatedAt: row.NoteUpdatedAt.Time.UTC().Format(time.RFC3339Nano)}, nil
}

// updateNote locks account, group and resource before comparing the note's independent version.
func (s *Service) updateNote(ctx context.Context, actor auth.CurrentUser, input NoteInput, admin bool) (NoteResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	actorID, err := parseNoteID(actor.ID)
	if err != nil {
		return NoteResult{}, ErrPermissionDenied
	}
	required := notePermissions(admin, true)
	if _, err = s.authorize(ctx, actor, required...); err != nil {
		return NoteResult{}, err
	}
	id, err := parseNoteID(input.ID)
	if err != nil {
		return NoteResult{}, err
	}
	expected, err := parseNoteVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return NoteResult{}, err
	}
	value, err := normalizeNote(input.Note)
	if err != nil {
		return NoteResult{}, err
	}
	var result NoteResult
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
		for _, p := range required {
			if !grants.Has(p) {
				return ErrPermissionDenied
			}
		}
		row, err := q.LockShortLinkNote(ctx, uuidToPgtype(id))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrShortLinkMissing
		}
		if err != nil {
			return err
		}
		if !admin && row.OwnerID.Bytes != actorID {
			return ErrShortLinkMissing
		}
		if !row.NoteUpdatedAt.Time.Equal(expected) {
			return ErrTransferConflict
		}
		if row.Note != value {
			updated, err := q.UpdateShortLinkNote(ctx, sqlc.UpdateShortLinkNoteParams{ID: row.ID, Note: value})
			if err != nil {
				return err
			}
			row.Note, row.NoteUpdatedAt = updated.Note, updated.NoteUpdatedAt
		}
		result = NoteResult{ID: input.ID, Note: row.Note, UpdatedAt: row.NoteUpdatedAt.Time.UTC().Format(time.RFC3339Nano)}
		return nil
	})
	if err != nil {
		return NoteResult{}, err
	}
	return result, nil
}
