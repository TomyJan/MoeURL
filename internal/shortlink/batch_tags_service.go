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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var ErrBatchTagsLimit = errors.New("resulting tag count exceeds limit")

// BatchTagItem pins a canonical link ID and a complete concurrency version.
type BatchTagItem struct {
	ID                string `json:"id"`
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

// BatchTagsInput applies one ordered tag operation to a bounded set of links.
type BatchTagsInput struct {
	Items     []BatchTagItem `json:"items"`
	Operation string         `json:"operation"`
	Tags      []string       `json:"tags"`
}

// BatchTagsResult counts actual changes and version-checked no-ops.
type BatchTagsResult struct {
	ChangedCount   int `json:"changedCount"`
	UnchangedCount int `json:"unchangedCount"`
}

// BatchTags edits tags on links currently owned by the actor.
func (s *Service) BatchTags(ctx context.Context, actor auth.CurrentUser, input BatchTagsInput) (BatchTagsResult, error) {
	return s.batchTags(ctx, actor, input, false)
}

// AdminBatchTags edits tags across owners after current administrative authorization.
func (s *Service) AdminBatchTags(ctx context.Context, actor auth.CurrentUser, input BatchTagsInput) (BatchTagsResult, error) {
	return s.batchTags(ctx, actor, input, true)
}

// batchTags rechecks current authorization and every locked link before changing any tags.
func (s *Service) batchTags(ctx context.Context, actor auth.CurrentUser, input BatchTagsInput, admin bool) (BatchTagsResult, error) {
	required := []string{permission.ShortLinkUpdateOwn, permission.ShortLinkSetMetadata}
	if admin {
		required = []string{permission.AdminAccess, permission.ShortLinkUpdateAll, permission.ShortLinkSetMetadata}
	}
	if _, err := s.authorize(ctx, actor, required...); err != nil {
		return BatchTagsResult{}, err
	}
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return BatchTagsResult{}, ErrPermissionDenied
	}
	ids, versions, tags, err := normalizeBatchTags(input)
	if err != nil {
		return BatchTagsResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
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
		if group.Key == "guest" {
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
		updatedTags := make([][]string, len(links))
		for i, link := range links {
			if !admin && link.OwnerID.Bytes != actorID {
				return ErrShortLinkMissing
			}
			if !link.UpdatedAt.Time.Equal(versions[link.ID.Bytes]) {
				return ErrTransferConflict
			}
			updatedTags[i] = applyBatchTags(link.Tags, tags, input.Operation)
			if len(updatedTags[i]) > 10 {
				return ErrBatchTagsLimit
			}
		}
		for i, link := range links {
			if slices.Equal(link.Tags, updatedTags[i]) {
				result.UnchangedCount++
				continue
			}
			if err := q.UpdateBatchTags(ctx, sqlc.UpdateBatchTagsParams{ID: link.ID, Tags: updatedTags[i]}); err != nil {
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

// normalizeBatchTags rejects ambiguous versions, duplicate IDs and invalid tag operations.
func normalizeBatchTags(input BatchTagsInput) ([]pgtype.UUID, map[uuid.UUID]time.Time, []string, error) {
	if len(input.Items) < 1 || len(input.Items) > 100 || (input.Operation != "add" && input.Operation != "remove" && input.Operation != "replace") || (input.Operation != "replace" && len(input.Tags) == 0) {
		return nil, nil, nil, ErrInvalidInput
	}
	tags, err := normalizeTags(input.Tags)
	if err != nil {
		return nil, nil, nil, err
	}
	ids := make([]pgtype.UUID, 0, len(input.Items))
	versions := make(map[uuid.UUID]time.Time, len(input.Items))
	for _, item := range input.Items {
		id, err := uuid.Parse(item.ID)
		expected, timeErr := time.Parse(time.RFC3339Nano, item.ExpectedUpdatedAt)
		if err != nil || id == uuid.Nil || id.String() != item.ID || timeErr != nil || expected.IsZero() {
			return nil, nil, nil, ErrInvalidInput
		}
		if _, exists := versions[id]; exists {
			return nil, nil, nil, ErrInvalidInput
		}
		ids = append(ids, uuidToPgtype(id))
		versions[id] = expected
	}
	return ids, versions, tags, nil
}

// applyBatchTags preserves existing order and appends new tags in request order.
func applyBatchTags(existing, tags []string, operation string) []string {
	if operation == "replace" {
		return tags
	}
	result := make([]string, 0, len(existing)+len(tags))
	if operation == "remove" {
		for _, tag := range existing {
			if !slices.Contains(tags, tag) {
				result = append(result, tag)
			}
		}
		return result
	}
	result = append(result, existing...)
	for _, tag := range tags {
		if !slices.Contains(result, tag) {
			result = append(result, tag)
		}
	}
	return result
}
