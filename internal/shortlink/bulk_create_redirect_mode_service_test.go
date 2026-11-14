package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBulkRedirectModeRejectsInvalidBeforeStorage catches invalid direct service input reaching a transaction.
func TestBulkRedirectModeRejectsInvalidBeforeStorage(t *testing.T) {
	base := func() shortlink.BatchCreateWithRedirectModesInput {
		return shortlink.BatchCreateWithRedirectModesInput{RequestID: "11111111-1111-4111-8111-111111115610", Items: []shortlink.BatchCreateRedirectModeItem{{TargetURL: "https://example.org", Title: "title", Tags: []string{}}}}
	}
	service := shortlink.NewService(nil, permission.NewService())
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000005510"}
	for name, mutate := range map[string]func(*shortlink.BatchCreateWithRedirectModesInput){
		"missing items": func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items = nil },
		"empty items": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			input.Items = []shortlink.BatchCreateRedirectModeItem{}
		},
		"too many": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			for range 20 {
				input.Items = append(input.Items, input.Items[0])
			}
		},
		"nil tags":      func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].Tags = nil },
		"too many tags": func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].Tags = make([]string, 11) },
		"bad title":     func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].Title = string([]byte{0xff}) },
		"bad tag": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			input.Items[0].Tags = []string{string([]byte{0xff})}
		},
		"bad UUID":        func(input *shortlink.BatchCreateWithRedirectModesInput) { input.RequestID = "invalid" },
		"unknown mode":    func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].RedirectMode = "custom" },
		"mode case":       func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].RedirectMode = "Direct" },
		"mode whitespace": func(input *shortlink.BatchCreateWithRedirectModesInput) { input.Items[0].RedirectMode = " direct" },
		"untrimmed custom slug": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			input.Items[0].CustomSlug = " Team56"
		},
		"duplicate URL": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			input.Items = append(input.Items, input.Items[0])
		},
		"duplicate normalized custom code": func(input *shortlink.BatchCreateWithRedirectModesInput) {
			input.Items[0].CustomSlug = "Team56"
			input.Items = append(input.Items, shortlink.BatchCreateRedirectModeItem{TargetURL: "https://example.net/other", Title: "other", Tags: []string{}, CustomSlug: "team56"})
		},
	} {
		t.Run(name, func(t *testing.T) {
			input := base()
			mutate(&input)
			_, err := service.BatchCreateWithRedirectModes(t.Context(), actor, input)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		})
	}
	input := base()
	input.Items[0].TargetURL = "ftp://example.org"
	_, err := service.BatchCreateWithRedirectModes(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrInvalidTargetURL)
	_, err = service.BatchCreateWithRedirectModes(t.Context(), auth.CurrentUser{ID: "invalid"}, base())
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}
