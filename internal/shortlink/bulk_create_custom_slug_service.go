package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

// BatchCreateCustomSlugItem preserves raw metadata and an explicitly blank or chosen slug.
type BatchCreateCustomSlugItem struct {
	TargetURL  string   `json:"targetUrl"`
	Title      string   `json:"title"`
	Tags       []string `json:"tags"`
	CustomSlug string   `json:"customSlug"`
}

// BatchCreateWithCustomSlugsInput keeps the fourth protocol separate from all legacy receipts.
type BatchCreateWithCustomSlugsInput struct {
	RequestID string                      `json:"requestId"`
	Items     []BatchCreateCustomSlugItem `json:"items"`
}

// BatchCreateWithCustomSlugs checks both metadata and custom-slug grants before any receipt replay.
func (s *Service) BatchCreateWithCustomSlugs(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithCustomSlugsInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithCustomSlugs(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags}
		if item.CustomSlug != "" {
			items[i].CustomSlug, _ = normalizeCustomSlug(item.CustomSlug)
		}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true, CustomSlugs: true})
}

// normalizeBulkCreateWithCustomSlugs rejects aliases within a batch while hashing original ordered text.
func normalizeBulkCreateWithCustomSlugs(input BatchCreateWithCustomSlugsInput) (uuid.UUID, [sha256.Size]byte, error) {
	metadata := BatchCreateWithMetadataInput{RequestID: input.RequestID, Items: make([]BatchCreateMetadataItem, len(input.Items))}
	seen := make(map[string]bool, len(input.Items))
	for i, item := range input.Items {
		metadata.Items[i] = BatchCreateMetadataItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags}
		if item.CustomSlug == "" {
			continue
		}
		slug, err := normalizeCustomSlug(item.CustomSlug)
		if err != nil {
			return uuid.Nil, [sha256.Size]byte{}, err
		}
		if seen[slug] {
			return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
		}
		seen[slug] = true
	}
	id, _, err := normalizeBulkCreateWithMetadata(metadata)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:custom-slugs:v1:"), encoded...)), nil
}
