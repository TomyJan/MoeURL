package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

// BatchCreateRedirectModeItem preserves all five raw fields for the independent receipt digest.
type BatchCreateRedirectModeItem struct {
	TargetURL    string   `json:"targetUrl"`
	Title        string   `json:"title"`
	Tags         []string `json:"tags"`
	CustomSlug   string   `json:"customSlug"`
	RedirectMode string   `json:"redirectMode"`
}

// BatchCreateWithRedirectModesInput binds ordered five-column rows to one shared request key.
type BatchCreateWithRedirectModesInput struct {
	RequestID string                        `json:"requestId"`
	Items     []BatchCreateRedirectModeItem `json:"items"`
}

// BatchCreateWithRedirectModes authorizes each requested mode before creating or replaying a receipt.
func (s *Service) BatchCreateWithRedirectModes(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithRedirectModesInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithRedirectModes(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, RedirectMode: item.RedirectMode}
		if item.CustomSlug != "" {
			items[i].CustomSlug, _ = normalizeCustomSlug(item.CustomSlug)
		}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true, CustomSlugs: true, RedirectModes: true})
}

// normalizeBulkCreateWithRedirectModes validates legacy fields and exact modes while hashing original text.
func normalizeBulkCreateWithRedirectModes(input BatchCreateWithRedirectModesInput) (uuid.UUID, [sha256.Size]byte, error) {
	custom := BatchCreateWithCustomSlugsInput{RequestID: input.RequestID, Items: make([]BatchCreateCustomSlugItem, len(input.Items))}
	for i, item := range input.Items {
		if item.RedirectMode != "" && !isAllowedRedirectMode(item.RedirectMode) {
			return uuid.Nil, [sha256.Size]byte{}, ErrInvalidInput
		}
		custom.Items[i] = BatchCreateCustomSlugItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, CustomSlug: item.CustomSlug}
	}
	id, _, err := normalizeBulkCreateWithCustomSlugs(custom)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:redirect-modes:v1:"), encoded...)), nil
}
