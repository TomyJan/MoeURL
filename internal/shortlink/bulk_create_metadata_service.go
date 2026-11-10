package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

// BatchCreateMetadataItem keeps raw ordered metadata separate from both existing wire protocols.
type BatchCreateMetadataItem struct {
	TargetURL string   `json:"targetUrl"`
	Title     string   `json:"title"`
	Tags      []string `json:"tags"`
}

// BatchCreateWithMetadataInput requires explicit tags, including an empty non-null array.
type BatchCreateWithMetadataInput struct {
	RequestID string                    `json:"requestId"`
	Items     []BatchCreateMetadataItem `json:"items"`
}

// batchCreateItem is an internal transaction input, preserving each public DTO and digest.
type batchCreateItem struct {
	TargetURL string
	Title     string
	Tags      []string
}

// BatchCreateWithMetadata checks current metadata grants even when replaying an existing receipt.
func (s *Service) BatchCreateWithMetadata(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithMetadataInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithMetadata(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags}
	}
	return s.batchCreate(ctx, actor, id, digest, items, true)
}

// normalizeBulkCreateWithMetadata keeps raw whitespace and tag order in a separate versioned digest.
func normalizeBulkCreateWithMetadata(input BatchCreateWithMetadataInput) (uuid.UUID, [sha256.Size]byte, error) {
	if len(input.Items) < 1 || len(input.Items) > 20 {
		return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
	}
	targets := make([]string, len(input.Items))
	for i, item := range input.Items {
		if !utf8.ValidString(item.Title) || item.Tags == nil || len(item.Tags) > 10 {
			return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
		}
		for _, tag := range item.Tags {
			if !utf8.ValidString(tag) {
				return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
			}
		}
		targets[i] = item.TargetURL
	}
	id, _, err := normalizeBulkCreate(BatchCreateInput{RequestID: input.RequestID, TargetURLs: targets})
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:metadata:v1:"), encoded...)), nil
}
