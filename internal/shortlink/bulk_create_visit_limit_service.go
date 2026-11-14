package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"strconv"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// BatchCreateVisitLimitItem retains all seven raw fields for its own receipt digest.
type BatchCreateVisitLimitItem struct {
	TargetURL    string   `json:"targetUrl"`
	Title        string   `json:"title"`
	Tags         []string `json:"tags"`
	CustomSlug   string   `json:"customSlug"`
	RedirectMode string   `json:"redirectMode"`
	ExpiresAt    string   `json:"expiresAt"`
	MaxVisits    string   `json:"maxVisits"`
}

// BatchCreateWithVisitLimitsInput keeps the seventh protocol independent of legacy numeric DTOs.
type BatchCreateWithVisitLimitsInput struct {
	RequestID string                      `json:"requestId"`
	Items     []BatchCreateVisitLimitItem `json:"items"`
}

// BatchCreateWithVisitLimits creates capped links or returns their original authorized receipt.
func (s *Service) BatchCreateWithVisitLimits(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithVisitLimitsInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithVisitLimits(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		expiry, _ := parseBulkExpiration(item.ExpiresAt)
		cap, _ := parseBulkVisitLimit(item.MaxVisits)
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, RedirectMode: item.RedirectMode, ExpiresAt: expiry, MaxVisits: cap}
		if item.CustomSlug != "" {
			items[i].CustomSlug, _ = normalizeCustomSlug(item.CustomSlug)
		}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true, CustomSlugs: true, RedirectModes: true, Expirations: true, VisitLimits: true})
}

// normalizeBulkCreateWithVisitLimits validates every legacy field while preserving raw cap text in its digest.
func normalizeBulkCreateWithVisitLimits(input BatchCreateWithVisitLimitsInput) (uuid.UUID, [sha256.Size]byte, error) {
	expirations := BatchCreateWithExpirationsInput{RequestID: input.RequestID, Items: make([]BatchCreateExpirationItem, len(input.Items))}
	for i, item := range input.Items {
		if _, err := parseBulkVisitLimit(item.MaxVisits); err != nil {
			return uuid.Nil, [sha256.Size]byte{}, err
		}
		expirations.Items[i] = BatchCreateExpirationItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, CustomSlug: item.CustomSlug, RedirectMode: item.RedirectMode, ExpiresAt: item.ExpiresAt}
	}
	id, _, err := normalizeBulkCreateWithExpirations(expirations)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:visit-limits:v1:"), encoded...)), nil
}

// parseBulkVisitLimit accepts only an empty value or canonical positive ASCII int32 decimal text.
func parseBulkVisitLimit(value string) (pgtype.Int8, error) {
	if value == "" {
		return pgtype.Int8{}, nil
	}
	if len(value) > 10 || value[0] < '1' || value[0] > '9' {
		return pgtype.Int8{}, ErrInvalidInput
	}
	for i := 1; i < len(value); i++ {
		if value[i] < '0' || value[i] > '9' {
			return pgtype.Int8{}, ErrInvalidInput
		}
	}
	n, err := strconv.ParseInt(value, 10, 32)
	if err != nil {
		return pgtype.Int8{}, ErrInvalidInput
	}
	return pgtype.Int8{Int64: n, Valid: true}, nil
}
