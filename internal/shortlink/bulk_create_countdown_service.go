package shortlink

import (
	"context"
	"crypto/sha256"
	"encoding/json"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
)

// BatchCreateCountdownItem preserves all eight raw fields in the independent receipt digest.
type BatchCreateCountdownItem struct {
	TargetURL                string   `json:"targetUrl"`
	Title                    string   `json:"title"`
	Tags                     []string `json:"tags"`
	CustomSlug               string   `json:"customSlug"`
	RedirectMode             string   `json:"redirectMode"`
	ExpiresAt                string   `json:"expiresAt"`
	MaxVisits                string   `json:"maxVisits"`
	IntermediateDelaySeconds string   `json:"intermediateDelaySeconds"`
}

// BatchCreateWithCountdownsInput separates the eighth wire protocol from legacy numeric DTOs.
type BatchCreateWithCountdownsInput struct {
	RequestID string                     `json:"requestId"`
	Items     []BatchCreateCountdownItem `json:"items"`
}

// BatchCreateWithCountdowns creates configured links once or returns their currently authorized receipt.
func (s *Service) BatchCreateWithCountdowns(ctx context.Context, actor auth.CurrentUser, input BatchCreateWithCountdownsInput) (BatchCreateResult, error) {
	id, digest, err := normalizeBulkCreateWithCountdowns(input)
	if err != nil {
		return BatchCreateResult{}, err
	}
	items := make([]batchCreateItem, len(input.Items))
	for i, item := range input.Items {
		expiry, _ := parseBulkExpiration(item.ExpiresAt)
		cap, _ := parseBulkVisitLimit(item.MaxVisits)
		delay, _ := parseBulkCountdown(item.IntermediateDelaySeconds, item.RedirectMode)
		items[i] = batchCreateItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, RedirectMode: item.RedirectMode, ExpiresAt: expiry, MaxVisits: cap, IntermediateDelaySeconds: delay}
		if item.CustomSlug != "" {
			items[i].CustomSlug, _ = normalizeCustomSlug(item.CustomSlug)
		}
	}
	return s.batchCreate(ctx, actor, id, digest, items, batchCreateOptions{Metadata: true, CustomSlugs: true, RedirectModes: true, Expirations: true, VisitLimits: true, Countdowns: true})
}

// normalizeBulkCreateWithCountdowns retains raw delay text and all legacy validation in a separate digest.
func normalizeBulkCreateWithCountdowns(input BatchCreateWithCountdownsInput) (uuid.UUID, [sha256.Size]byte, error) {
	limits := BatchCreateWithVisitLimitsInput{RequestID: input.RequestID, Items: make([]BatchCreateVisitLimitItem, len(input.Items))}
	for i, item := range input.Items {
		if _, err := parseBulkCountdown(item.IntermediateDelaySeconds, item.RedirectMode); err != nil {
			return uuid.Nil, [sha256.Size]byte{}, err
		}
		limits.Items[i] = BatchCreateVisitLimitItem{TargetURL: item.TargetURL, Title: item.Title, Tags: item.Tags, CustomSlug: item.CustomSlug, RedirectMode: item.RedirectMode, ExpiresAt: item.ExpiresAt, MaxVisits: item.MaxVisits}
	}
	id, _, err := normalizeBulkCreateWithVisitLimits(limits)
	if err != nil {
		return uuid.Nil, [sha256.Size]byte{}, err
	}
	encoded, _ := json.Marshal(input.Items)
	return id, sha256.Sum256(append([]byte("moeurl:bulk-create:countdowns:v1:"), encoded...)), nil
}

// parseBulkCountdown accepts empty defaults or canonical intermediate-only ASCII seconds.
func parseBulkCountdown(value, mode string) (int16, error) {
	if value == "" {
		return 5, nil
	}
	if mode != RedirectModeIntermediate {
		return 0, ErrInvalidInput
	}
	switch value {
	case "3", "4", "5", "6", "7", "8", "9":
		return int16(value[0] - '0'), nil
	case "10":
		return 10, nil
	default:
		return 0, ErrInvalidInput
	}
}
