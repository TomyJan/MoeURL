package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

// BatchCreateItem retains one URL and its raw title in the ordered request digest.
type BatchCreateItem struct {
	TargetURL string `json:"targetUrl"`
	Title     string `json:"title"`
}

// BatchCreateWithTitlesInput uses a separate protocol without changing legacy receipts.
type BatchCreateWithTitlesInput struct {
	RequestID string            `json:"requestId"`
	Items     []BatchCreateItem `json:"items"`
}

// BatchCreateWithTitles checks current metadata grants before reading or writing a shared receipt.
func (s *Service) BatchCreateWithTitles(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithTitlesInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithTitles(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: []string{}}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true})
}

// normalizeBulkCreateWithTitles shares URL limits while keeping raw ordered title bytes in a distinct digest.
func normalizeBulkCreateWithTitles(input BatchCreateWithTitlesInput) (uuid.UUID, [sha256.Size]byte, error) {
	if len(input.Items) < 1 || len(input.Items) > 20 {
		return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
	}
	targets := make([]string, len(input.Items))
	for i, item := range input.Items {
		if !utf8.ValidString(item.Title) {
			return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
		}
		targets[i] = item.TargetURL
	}
	id, _, err := normalizeBulkCreate(BatchCreateInput{RequestID: input.RequestID, TargetURLs: targets})
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:titles:v1:"), encoded...)), nil
}
