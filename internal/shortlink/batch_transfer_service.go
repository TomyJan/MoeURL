package shortlink

import (
	"context"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchTransferItem pins a single canonical link ID and complete concurrency version.
type BatchTransferItem struct {
	ID                string `json:"id"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

// BatchTransferInput describes one bounded, atomic administrative handoff.
type BatchTransferInput struct {
	Items            []BatchTransferItem `json:"items"`
	NewOwnerUsername string              `json:"newOwnerUsername"`
}

// BatchTransferResult separates actual ownership changes from version-checked no-ops.
type BatchTransferResult struct {
	TransferredCount int `json:"transferredCount"`
	UnchangedCount   int `json:"unchangedCount"`
}

// BatchTransfer validates every locked version before writing any owner or audit record.
func (s *Service) BatchTransfer(ctx context.Context, actor auth.CurrentUser, input BatchTransferInput) (BatchTransferResult, error) {
	if _, err := s.authorizeAdmin(ctx, actor, permission.ShortLinkUpdateAll); err != nil {
		return BatchTransferResult{}, err
	}
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return BatchTransferResult{}, ErrPermissionDenied
	}
	ids, versions, err := normalizeBatchTransfer(input)
	if err != nil {
		return BatchTransferResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result BatchTransferResult
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		recipient, err := lockTransferParticipants(ctx, q, actorID, input.NewOwnerUsername)
		if err != nil {
			return err
		}
		links, err := q.LockBatchTransferShortLinks(ctx, ids)
		if err != nil {
			return err
		}
		if len(links) != len(ids) {
			return ErrShortLinkMissing
		}
		for _, link := range links {
			if !link.UpdatedAt.Time.Equal(versions[link.ID.Bytes]) {
				return ErrTransferConflict
			}
		}
		for _, link := range links {
			if link.OwnerID == recipient {
				result.UnchangedCount++
				continue
			}
			if _, err := q.TransferShortLinkOwner(ctx, sqlc.TransferShortLinkOwnerParams{ID: link.ID, OwnerID: recipient}); err != nil {
				return err
			}
			result.TransferredCount++
		}
		return nil
	})
	if err != nil {
		return BatchTransferResult{}, err
	}
	return result, nil
}

// normalizeBatchTransfer rejects missing versions and noncanonical or duplicate IDs before opening a transaction.
func normalizeBatchTransfer(input BatchTransferInput) ([]pgtype.UUID, map[uuid.UUID]time.Time, error) {
	if len(input.Items) < 1 || len(input.Items) > 100 || input.NewOwnerUsername == "" {
		return nil, nil, ErrInvalidInput
	}
	ids := make([]pgtype.UUID, 0, len(input.Items))
	versions := make(map[uuid.UUID]time.Time, len(input.Items))
	for _, item := range input.Items {
		id, err := uuid.Parse(item.ID)
		expected, timeErr := time.Parse(time.RFC3339Nano, item.ExpectedUpdatedAt)
		if err != nil || id == uuid.Nil || id.String() != item.ID || timeErr != nil || expected.IsZero() {
			return nil, nil, ErrInvalidInput
		}
		if _, exists := versions[id]; exists {
			return nil, nil, ErrInvalidInput
		}
		versions[id] = expected
		ids = append(ids, uuidToPgtype(id))
	}
	return ids, versions, nil
}
