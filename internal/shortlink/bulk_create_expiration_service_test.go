package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBulkExpirationRejectsInvalidBeforeStorage catches invalid direct service input reaching a transaction.
func TestBulkExpirationRejectsInvalidBeforeStorage(t *testing.T) {
	base := func() shortlink.BatchCreateWithExpirationsInput {
		return shortlink.BatchCreateWithExpirationsInput{RequestID: "11111111-1111-4111-8111-111111115610", Items: []shortlink.BatchCreateExpirationItem{{TargetURL: "https://example.org", Title: "title", Tags: []string{}}}}
	}
	service := shortlink.NewService(nil, permission.NewService())
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000005510"}
	for name, mutate := range map[string]func(*shortlink.BatchCreateWithExpirationsInput){
		"missing items": func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items = nil },
		"empty items": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items = []shortlink.BatchCreateExpirationItem{}
		},
		"too many": func(input *shortlink.BatchCreateWithExpirationsInput) {
			for range 20 {
				input.Items = append(input.Items, input.Items[0])
			}
		},
		"nil tags":      func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].Tags = nil },
		"too many tags": func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].Tags = make([]string, 11) },
		"bad title":     func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].Title = string([]byte{0xff}) },
		"bad tag": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items[0].Tags = []string{string([]byte{0xff})}
		},
		"bad expiry": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items[0].ExpiresAt = "2099-02-29T00:00:00Z"
		},
		"expiry offset": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items[0].ExpiresAt = "2099-01-01T00:00:00+00:00"
		},
		"bad UUID":        func(input *shortlink.BatchCreateWithExpirationsInput) { input.RequestID = "invalid" },
		"unknown mode":    func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].RedirectMode = "custom" },
		"mode case":       func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].RedirectMode = "Direct" },
		"mode whitespace": func(input *shortlink.BatchCreateWithExpirationsInput) { input.Items[0].RedirectMode = " direct" },
		"untrimmed custom slug": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items[0].CustomSlug = " Team56"
		},
		"duplicate URL": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items = append(input.Items, input.Items[0])
		},
		"duplicate normalized custom code": func(input *shortlink.BatchCreateWithExpirationsInput) {
			input.Items[0].CustomSlug = "Team56"
			input.Items = append(input.Items, shortlink.BatchCreateExpirationItem{TargetURL: "https://example.net/other", Title: "other", Tags: []string{}, CustomSlug: "team56"})
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := base()
			mutate(&input)
			_, err := service.BatchCreateWithExpirations(t.Context(), actor, input)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		})
	}
	input := base()
	input.Items[0].TargetURL = "ftp://example.org"
	_, err := service.BatchCreateWithExpirations(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrInvalidTargetURL)
	_, err = service.BatchCreateWithExpirations(t.Context(), auth.CurrentUser{ID: "invalid"}, base())
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}
