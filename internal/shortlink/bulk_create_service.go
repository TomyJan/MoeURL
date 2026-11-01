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
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var ErrBulkCreateConflict = errors.New("batch request key has different content")

// BatchCreateInput binds one ordered bounded URL batch to a caller-generated idempotency key.
type BatchCreateInput struct {
	RequestID  string   `json:"requestId"`
	TargetURLs []string `json:"targetUrls"`
}

// BatchCreateResult returns a stable receipt without retaining private target URLs.
type BatchCreateResult struct {
	RequestID    string `json:"requestId"`
	CreatedCount int    `json:"createdCount"`
}

// BatchCreate commits personal links, per-link audit and the replay receipt atomically.
func (s *Service) BatchCreate(ctx context.Context, actor auth.CurrentUser, input BatchCreateInput) (BatchCreateResult, error) {
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return BatchCreateResult{}, ErrPermissionDenied
	}
	requestID, digest, err := normalizeBulkCreate(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	result := BatchCreateResult{RequestID: input.RequestID}
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := domain.LockShortLinkCreation(ctx, tx); err != nil {
			return err
		}
		q := s.queries.WithTx(tx)
		current, err := q.LockBulkCreateActor(ctx, uuidToPgtype(actorID))
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
		if group.Key == "guest" || !grants.Has(permission.ShortLinkCreate) || !grants.Has(permission.DomainUseDefault) {
			return ErrPermissionDenied
		}
		receipt, err := q.GetBulkCreateReceipt(ctx, sqlc.GetBulkCreateReceiptParams{
			ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID),
		})
		if err == nil {
			if !bytes.Equal(receipt.RequestHash, digest[:]) {
				return ErrBulkCreateConflict
			}
			result.CreatedCount = int(receipt.CreatedCount)
			return nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		selected, err := q.GetGrantedShortLinkDomainForCreate(ctx, sqlc.GetGrantedShortLinkDomainForCreateParams{
			GroupKey: group.Key, RequiredPermission: permission.DomainUseDefault, UseDefault: true,
			DomainID: uuidToPgtype(uuid.Nil),
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrDomainUnavailable
		}
		if err != nil {
			return err
		}
		for _, target := range input.TargetURLs {
			created := false
			for attempt := 0; attempt < maxSlugAttempts; attempt++ {
				slug, err := generateSlug()
				if err != nil {
					return err
				}
				if isReservedSlug(slug) {
					continue
				}
				_, err = q.CreateBulkShortLink(ctx, sqlc.CreateBulkShortLinkParams{
					ID: uuidToPgtype(uuid.New()), OwnerID: uuidToPgtype(actorID), DomainID: selected.ID,
					Slug: slug, TargetUrl: target,
				})
				if errors.Is(err, pgx.ErrNoRows) {
					continue
				}
				if err != nil {
					return err
				}
				created = true
				break
			}
			if !created {
				return ErrSlugConflict
			}
		}
		if err := q.InsertBulkCreateReceipt(ctx, sqlc.InsertBulkCreateReceiptParams{
			ActorID: uuidToPgtype(actorID), RequestID: uuidToPgtype(requestID),
			RequestHash: digest[:], CreatedCount: int16(len(input.TargetURLs)),
		}); err != nil {
			return err
		}
		result.CreatedCount = len(input.TargetURLs)
		return nil
	})
	if err != nil {
		return BatchCreateResult{}, err
	}
	return result, nil
}

// normalizeBulkCreate rejects ambiguous batches before deriving a versioned ordered content digest.
func normalizeBulkCreate(input BatchCreateInput) (uuid.UUID, [sha256.Size]byte, error) {
	id, err := uuid.Parse(input.RequestID)
	if err != nil || id == uuid.Nil || id.String() != input.RequestID || len(input.TargetURLs) < 1 || len(input.TargetURLs) > 20 {
		return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
	}
	seen := make(map[string]bool, len(input.TargetURLs))
	for _, target := range input.TargetURLs {
		if len(target) < 1 || len(target) > 2048 || seen[target] {
			return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
		}
		for i := 0; i < len(target); i++ {
			if target[i] < 0x21 || target[i] > 0x7e {
				return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
			}
		}
		if err := validateTargetURL(target); err != nil {
			return uuid.Nil, [sha256.Size]byte{}, err
		}
		seen[target] = true
	}
	encoded, _ := json.Marshal(input.TargetURLs)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:v1:"), encoded...)), nil
}
