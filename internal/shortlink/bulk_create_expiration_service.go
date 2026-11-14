package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchCreateExpirationItem preserves all six raw fields for its independent receipt digest.
type BatchCreateExpirationItem struct {
	TargetURL    string   `json:"targetUrl"`
	Title        string   `json:"title"`
	Tags         []string `json:"tags"`
	CustomSlug   string   `json:"customSlug"`
	RedirectMode string   `json:"redirectMode"`
	ExpiresAt    string   `json:"expiresAt"`
}

// BatchCreateWithExpirationsInput binds ordered six-column rows to one shared request key.
type BatchCreateWithExpirationsInput struct {
	RequestID string                      `json:"requestId"`
	Items     []BatchCreateExpirationItem `json:"items"`
}

// BatchCreateWithExpirations checks current grants before new writes and receipt replay.
func (s *Service) BatchCreateWithExpirations(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithExpirationsInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithExpirations(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		expiry, _ := parseBulkExpiration(item.ExpiresAt)
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, RedirectMode: item.RedirectMode, ExpiresAt: expiry}
		if item.CustomSlug != "" {
			items[i].CustomSlug, _ = normalizeCustomSlug(item.CustomSlug)
		}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true, CustomSlugs: true, RedirectModes: true, Expirations: true})
}

// normalizeBulkCreateWithExpirations validates canonical dates without discarding raw digest content.
func normalizeBulkCreateWithExpirations(input BatchCreateWithExpirationsInput) (uuid.UUID, [sha256.Size]byte, error) {
	modes := BatchCreateWithRedirectModesInput{RequestID: input.RequestID, Items: make([]BatchCreateRedirectModeItem, len(input.Items))}
	for i, item := range input.Items {
		if _, err := parseBulkExpiration(item.ExpiresAt); err != nil {
			return uuid.Nil, [sha256.Size]byte{}, err
		}
		modes.Items[i] = BatchCreateRedirectModeItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, CustomSlug: item.CustomSlug, RedirectMode: item.RedirectMode}
	}
	id, _, err := normalizeBulkCreateWithRedirectModes(modes)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:expirations:v1:"), encoded...)), nil
}

// parseBulkExpiration accepts only UTC seconds, avoiding timezone aliases and lossy date normalization.
func parseBulkExpiration(value string) (pgtype.Timestamptz, error) {
	if value == "" {
		return pgtype.Timestamptz{}, nil
	}
	const layout = "2006-01-02T15:04:05Z"
	if len(value) != len(layout) {
		return pgtype.Timestamptz{}, ErrInvalidInput
	}
	parsed, err := time.Parse(layout, value)
	if err != nil || parsed.Year() < 1 || parsed.Format(layout) != value {
		return pgtype.Timestamptz{}, ErrInvalidInput
	}
	return pgtype.Timestamptz{Time: parsed, Valid: true}, nil
}
