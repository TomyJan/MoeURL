package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBulkCountdownServiceRejectsBeforeStorage keeps direct callers inside the same validation contract as HTTP.
func TestBulkCountdownServiceRejectsBeforeStorage(t *testing.T) {
	valid := func() shortlink.BatchCreateWithCountdownsInput {
		return shortlink.BatchCreateWithCountdownsInput{RequestID: "11111111-1111-4111-8111-111111117609", Items: []shortlink.BatchCreateCountdownItem{{TargetURL: "https://example.org/cap76", Tags: []string{}, MaxVisits: "1", RedirectMode: "intermediate", IntermediateDelaySeconds: "3"}}}
	}
	for name, alter := range map[string]func(*shortlink.BatchCreateWithCountdownsInput){
		"missing rows":       func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items = nil },
		"bad request id":     func(in *shortlink.BatchCreateWithCountdownsInput) { in.RequestID = "invalid" },
		"invalid cap":        func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items[0].MaxVisits = "+1" },
		"invalid delay":      func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items[0].IntermediateDelaySeconds = "03" },
		"invalid expiration": func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items[0].ExpiresAt = "2099-02-31T00:00:00Z" },
		"invalid mode":       func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items[0].RedirectMode = "Direct" },
		"null tags":          func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items[0].Tags = nil },
		"duplicate targets":  func(in *shortlink.BatchCreateWithCountdownsInput) { in.Items = append(in.Items, in.Items[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			in := valid()
			alter(&in)
			result, err := shortlink.NewService(nil, nil).BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{ID: "11111111-1111-4111-8111-111111117610"}, in)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
			require.Zero(t, result)
		})
	}
	result, err := shortlink.NewService(nil, nil).BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{}, valid())
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Zero(t, result)
}

// TestBulkCountdownRejectsNonCanonicalSeconds catches coercion and silently ignored non-intermediate delays.
func TestBulkCountdownRejectsNonCanonicalSeconds(t *testing.T) {
	for _, mode := range []string{"", "direct", "confirmation", "intermediate"} {
		for _, delay := range []string{"", "3", "4", "5", "6", "7", "8", "9", "10", "2", "11", "0", "-1", "+3", "03", "3.0", "3e0", " ", " 3", "3 ", "３", "٣", "3\n", "\x00"} {
			t.Run(mode+"/"+delay, func(t *testing.T) {
				input := shortlink.BatchCreateWithCountdownsInput{RequestID: "11111111-1111-4111-8111-111111117711", Items: []shortlink.BatchCreateCountdownItem{{TargetURL: "https://example.org/delay77", Tags: []string{}, RedirectMode: mode, IntermediateDelaySeconds: delay}}}
				result, err := shortlink.NewService(nil, nil).BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{}, input)
				valid := delay == "" || mode == "intermediate" && (delay == "3" || delay == "4" || delay == "5" || delay == "6" || delay == "7" || delay == "8" || delay == "9" || delay == "10")
				if valid {
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				} else {
					require.ErrorIs(t, err, shortlink.ErrInvalidInput)
				}
				require.Zero(t, result)
			})
		}
	}
}

// TestBulkCountdownRejectsNonCanonicalCaps catches permissive decimal coercion before any storage access.
func TestBulkCountdownRejectsNonCanonicalCaps(t *testing.T) {
	for _, cap := range []string{"0", "01", "+1", "-1", " 1", "1 ", "1.0", "1e2", "１", "2147483648", "10000000000"} {
		t.Run(cap, func(t *testing.T) {
			input := shortlink.BatchCreateWithCountdownsInput{RequestID: "11111111-1111-4111-8111-111111117611", Items: []shortlink.BatchCreateCountdownItem{{TargetURL: "https://example.org/cap76", Tags: []string{}, MaxVisits: cap, RedirectMode: "intermediate", IntermediateDelaySeconds: "3"}}}
			result, err := shortlink.NewService(nil, nil).BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{}, input)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
			require.Zero(t, result)
		})
	}
}
