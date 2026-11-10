package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBulkMetadataRejectsInvalidBeforeStorage catches invalid direct service input reaching a transaction.
func TestBulkMetadataRejectsInvalidBeforeStorage(t *testing.T) {
	base := func() shortlink.BatchCreateWithMetadataInput {
		return shortlink.BatchCreateWithMetadataInput{RequestID: "11111111-1111-4111-8111-111111115510", Items: []shortlink.BatchCreateMetadataItem{{TargetURL: "https://example.org", Title: "title", Tags: []string{}}}}
	}
	service := shortlink.NewService(nil, permission.NewService())
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000005510"}
	for name, mutate := range map[string]func(*shortlink.BatchCreateWithMetadataInput){
		"missing items": func(input *shortlink.BatchCreateWithMetadataInput) { input.Items = nil },
		"empty items": func(input *shortlink.BatchCreateWithMetadataInput) {
			input.Items = []shortlink.BatchCreateMetadataItem{}
		},
		"too many": func(input *shortlink.BatchCreateWithMetadataInput) {
			for range 20 {
				input.Items = append(input.Items, input.Items[0])
			}
		},
		"nil tags":      func(input *shortlink.BatchCreateWithMetadataInput) { input.Items[0].Tags = nil },
		"too many tags": func(input *shortlink.BatchCreateWithMetadataInput) { input.Items[0].Tags = make([]string, 11) },
		"bad title":     func(input *shortlink.BatchCreateWithMetadataInput) { input.Items[0].Title = string([]byte{0xff}) },
		"bad tag": func(input *shortlink.BatchCreateWithMetadataInput) {
			input.Items[0].Tags = []string{string([]byte{0xff})}
		},
		"bad UUID":      func(input *shortlink.BatchCreateWithMetadataInput) { input.RequestID = "invalid" },
		"duplicate URL": func(input *shortlink.BatchCreateWithMetadataInput) { input.Items = append(input.Items, input.Items[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			input := base()
			mutate(&input)
			_, err := service.BatchCreateWithMetadata(t.Context(), actor, input)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		})
	}
	input := base()
	input.Items[0].TargetURL = "ftp://example.org"
	_, err := service.BatchCreateWithMetadata(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrInvalidTargetURL)
	_, err = service.BatchCreateWithMetadata(t.Context(), auth.CurrentUser{ID: "invalid"}, base())
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}
