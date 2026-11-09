package shortlink

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
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

var ErrNoteAppendRequestConflict = errors.New("batch note append request has different content")

func (s *Service) PreviewOwnNoteAppend(ctx context.Context, actor auth.CurrentUser, input BatchNoteAppendPreviewInput) (BatchNoteAppendPreviewResult, error) {
	return s.previewBatchNoteAppend(ctx, actor, input, false)
}

func (s *Service) PreviewAdminNoteAppend(ctx context.Context, actor auth.CurrentUser, input BatchNoteAppendPreviewInput) (BatchNoteAppendPreviewResult, error) {
	return s.previewBatchNoteAppend(ctx, actor, input, true)
}

func (s *Service) previewBatchNoteAppend(ctx context.Context, actor auth.CurrentUser, input BatchNoteAppendPreviewInput, admin bool) (BatchNoteAppendPreviewResult, error) {
	items := previewNoteItems(BatchNotePreviewInput{Items: input.Items})
	result, _, err := s.batchNoteAppend(ctx, actor, items, input.Note, "", admin, false)
	return result, err
}

func (s *Service) AppendOwnNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteAppendInput) (BatchNoteAppendResult, error) {
	_, result, err := s.batchNoteAppend(ctx, actor, input.Items, input.Note, input.RequestID, false, true)
	return result, err
}

func (s *Service) AppendAdminNotes(ctx context.Context, actor auth.CurrentUser, input BatchNoteAppendInput) (BatchNoteAppendResult, error) {
	_, result, err := s.batchNoteAppend(ctx, actor, input.Items, input.Note, input.RequestID, true, true)
	return result, err
}

type lockedBatchNoteAppend struct {
	id, owner  pgtype.UUID
	main, note pgtype.Timestamptz
	canAppend  bool
}

type batchNoteAppendHashItem struct {
	ID                    string `json:"id"`
	ExpectedUpdatedAt     string `json:"expectedUpdatedAt"`
	ExpectedNoteUpdatedAt string `json:"expectedNoteUpdatedAt"`
}

type batchNoteAppendHashPayload struct {
	Domain  string                    `json:"domain"`
	Version int                       `json:"version"`
	Scope   string                    `json:"scope"`
	Items   []batchNoteAppendHashItem `json:"items"`
	Note    string                    `json:"note"`
}

// batchNoteAppendHash hashes the complete normalized request without storing any note text.
func batchNoteAppendHash(scope string, items []BatchNoteClearItem, versions map[uuid.UUID]batchNoteVersions, note string) [sha256.Size]byte {
	canonical := batchNoteAppendHashPayload{Domain: "moeurl.short-link.note.batch-append", Version: 1, Scope: scope, Items: make([]batchNoteAppendHashItem, len(items)), Note: note}
	for i, item := range items {
		id, _ := parseNoteID(item.ID)
		version := versions[id]
		canonical.Items[i] = batchNoteAppendHashItem{
			ID:                    id.String(),
			ExpectedUpdatedAt:     version.main.UTC().Format(time.RFC3339Nano),
			ExpectedNoteUpdatedAt: version.note.UTC().Format(time.RFC3339Nano),
		}
	}
	raw, _ := json.Marshal(canonical)
	return sha256.Sum256(raw)
}

// batchNoteAppend locks and validates the complete selection before changing any note.
func (s *Service) batchNoteAppend(ctx context.Context, actor auth.CurrentUser, items []BatchNoteClearItem, rawNote, rawRequestID string, admin, write bool) (BatchNoteAppendPreviewResult, BatchNoteAppendResult, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var preview BatchNoteAppendPreviewResult
	var result BatchNoteAppendResult
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
	var requestID uuid.UUID
	requestHash := [sha256.Size]byte{}
	scope := "own"
	if admin {
		scope = "admin"
	}
	if write {
		requestID, err = parseNoteID(rawRequestID)
		if err != nil {
			return preview, result, ErrInvalidInput
		}
		requestHash = batchNoteAppendHash(scope, items, versions, note)
		result.RequestID = requestID.String()
	}
	transaction := func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		var currentID, groupID pgtype.UUID
		var status string
		var deletedAt pgtype.Timestamptz
		if write {
			current, err := q.LockBatchNoteAppendActor(ctx, uuidToPgtype(actorID))
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPermissionDenied
			}
			if err != nil {
				return err
			}
			currentID, groupID, status, deletedAt = current.ID, current.GroupID, current.Status, current.DeletedAt
		} else {
			current, err := q.LockBatchTagsActor(ctx, uuidToPgtype(actorID))
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPermissionDenied
			}
			if err != nil {
				return err
			}
			currentID, groupID, status, deletedAt = current.ID, current.GroupID, current.Status, current.DeletedAt
		}
		if !currentID.Valid || currentID.Bytes != actorID || status != "active" || deletedAt.Valid {
			return ErrPermissionDenied
		}
		group, err := q.LockTransferActorGroup(ctx, groupID)
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
		if write {
			receipt, err := q.ReadBatchNoteAppendReceipt(ctx, sqlc.ReadBatchNoteAppendReceiptParams{ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID)})
			if err == nil {
				if !bytes.Equal(receipt.RequestHash, requestHash[:]) {
					return ErrNoteAppendRequestConflict
				}
				result.AppendedCount = int(receipt.AppendedCount)
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		var links []lockedBatchNoteAppend
		if write {
			rows, err := q.LockBatchNoteAppendTargets(ctx, sqlc.LockBatchNoteAppendTargetsParams{AppendText: note, Ids: ids})
			if err != nil {
				return err
			}
			for _, row := range rows {
				links = append(links, lockedBatchNoteAppend{row.ID, row.OwnerID, row.UpdatedAt, row.NoteUpdatedAt, row.CanAppend})
			}
		} else {
			rows, err := q.LockBatchNoteAppendPreview(ctx, sqlc.LockBatchNoteAppendPreviewParams{AppendText: note, Ids: ids})
			if err != nil {
				return err
			}
			for _, row := range rows {
				links = append(links, lockedBatchNoteAppend{row.ID, row.OwnerID, row.UpdatedAt, row.NoteUpdatedAt, row.CanAppend})
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
				if !link.canAppend {
					return ErrInvalidInput
				}
			}
			for _, link := range links {
				if _, err := q.AppendShortLinkNote(ctx, sqlc.AppendShortLinkNoteParams{ID: link.id, Note: note}); err != nil {
					return err
				}
			}
			result.AppendedCount = len(links)
			return q.InsertBatchNoteAppendReceipt(ctx, sqlc.InsertBatchNoteAppendReceiptParams{ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID), RequestHash: requestHash[:], AppendedCount: int16(len(links))})
		}
		byID := make(map[uuid.UUID]lockedBatchNoteAppend, len(links))
		for _, link := range links {
			byID[link.id.Bytes] = link
		}
		preview.Items = make([]BatchNoteAppendPreviewResultItem, 0, len(items))
		for _, item := range items {
			id, _ := parseNoteID(item.ID)
			link := byID[id]
			preview.Items = append(preview.Items, BatchNoteAppendPreviewResultItem{ID: id.String(), ExpectedUpdatedAt: link.main.Time.UTC().Format(time.RFC3339Nano), ExpectedNoteUpdatedAt: link.note.Time.UTC().Format(time.RFC3339Nano)})
			if link.canAppend {
				preview.AppendableCount++
			} else {
				preview.OverflowCount++
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
		return BatchNoteAppendPreviewResult{}, BatchNoteAppendResult{}, err
	}
	return preview, result, nil
}
