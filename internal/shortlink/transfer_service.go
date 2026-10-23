package shortlink

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrTransferConflict             = errors.New("short link changed")
	ErrTransferRecipientUnavailable = errors.New("transfer recipient unavailable")
)

// TransferInput fixes one link version and an exact recipient account name.
type TransferInput struct {
	ID                string `json:"id"`
	NewOwnerUsername  string `json:"newOwnerUsername"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

// TransferResult contains only the new ownership identity and concurrency version.
type TransferResult struct {
	ID        string `json:"id"`
	OwnerID   string `json:"ownerId"`
	UpdatedAt string `json:"updatedAt"`
}

// Transfer atomically reauthorizes an administrative handoff and its owner_id audit.
func (s *Service) Transfer(ctx context.Context, actor auth.CurrentUser, input TransferInput) (TransferResult, error) {
	if _, err := s.authorizeAdmin(ctx, actor, permission.ShortLinkUpdateAll); err != nil {
		return TransferResult{}, err
	}
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return TransferResult{}, ErrPermissionDenied
	}
	id, err := uuid.Parse(input.ID)
	expected, timeErr := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || id == uuid.Nil || id.String() != input.ID || timeErr != nil || expected.IsZero() || input.NewOwnerUsername == "" || len(input.NewOwnerUsername) > 64 || strings.TrimSpace(input.NewOwnerUsername) != input.NewOwnerUsername {
		return TransferResult{}, ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result TransferResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		users, err := q.LockTransferUsers(ctx, sqlc.LockTransferUsersParams{ActorID: uuidToPgtype(actorID), Username: input.NewOwnerUsername})
		if err != nil {
			return err
		}
		var current, recipient *sqlc.LockTransferUsersRow
		for i := range users {
			if users[i].ID.Bytes == actorID {
				current = &users[i]
			}
			if users[i].Username == input.NewOwnerUsername {
				recipient = &users[i]
			}
		}
		if current == nil || current.Status != "active" || current.DeletedAt.Valid {
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
		if group.Key == "guest" || !grants.Has(permission.AdminAccess) || !grants.Has(permission.ShortLinkUpdateAll) {
			return ErrPermissionDenied
		}
		if recipient == nil || recipient.Status != "active" || recipient.DeletedAt.Valid || (recipient.GroupKey != "user" && recipient.GroupKey != "admin") {
			return ErrTransferRecipientUnavailable
		}
		link, err := q.LockTransferShortLink(ctx, uuidToPgtype(id))
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrShortLinkMissing
		}
		if err != nil {
			return err
		}
		if !link.UpdatedAt.Time.Equal(expected) {
			return ErrTransferConflict
		}
		if link.OwnerID != recipient.ID {
			updated, err := q.TransferShortLinkOwner(ctx, sqlc.TransferShortLinkOwnerParams{ID: link.ID, OwnerID: recipient.ID})
			if err != nil {
				return err
			}
			link.OwnerID, link.UpdatedAt = updated.OwnerID, updated.UpdatedAt
		}
		result = TransferResult{ID: input.ID, OwnerID: uuidFromPgtype(link.OwnerID), UpdatedAt: link.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)}
		return nil
	})
	return result, err
}
