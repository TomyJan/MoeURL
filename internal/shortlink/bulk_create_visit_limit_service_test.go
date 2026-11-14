package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestBulkVisitLimitServiceRejectsBeforeStorage keeps direct callers inside the same validation contract as HTTP.
func TestBulkVisitLimitServiceRejectsBeforeStorage(t *testing.T) {
	valid := func() shortlink.BatchCreateWithVisitLimitsInput {
		return shortlink.BatchCreateWithVisitLimitsInput{RequestID: "11111111-1111-4111-8111-111111117609", Items: []shortlink.BatchCreateVisitLimitItem{{TargetURL: "https://example.org/cap76", Tags: []string{}, MaxVisits: "1"}}}
	}
	for name, alter := range map[string]func(*shortlink.BatchCreateWithVisitLimitsInput){
		"missing rows":       func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items = nil },
		"bad request id":     func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.RequestID = "invalid" },
		"invalid cap":        func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items[0].MaxVisits = "+1" },
		"invalid expiration": func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items[0].ExpiresAt = "2099-02-31T00:00:00Z" },
		"invalid mode":       func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items[0].RedirectMode = "Direct" },
		"null tags":          func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items[0].Tags = nil },
		"duplicate targets":  func(in *shortlink.BatchCreateWithVisitLimitsInput) { in.Items = append(in.Items, in.Items[0]) },
	} {
		t.Run(name, func(t *testing.T) {
			in := valid()
			alter(&in)
			result, err := shortlink.NewService(nil, nil).BatchCreateWithVisitLimits(t.Context(), auth.CurrentUser{ID: "11111111-1111-4111-8111-111111117610"}, in)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
			require.Zero(t, result)
		})
	}
	result, err := shortlink.NewService(nil, nil).BatchCreateWithVisitLimits(t.Context(), auth.CurrentUser{}, valid())
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Zero(t, result)
}

// TestBulkVisitLimitRejectsNonCanonicalCaps catches permissive decimal coercion before any storage access.
func TestBulkVisitLimitRejectsNonCanonicalCaps(t *testing.T) {
	for _, cap := range []string{"0", "01", "+1", "-1", " 1", "1 ", "1.0", "1e2", "１", "2147483648", "10000000000"} {
		t.Run(cap, func(t *testing.T) {
			input := shortlink.BatchCreateWithVisitLimitsInput{RequestID: "11111111-1111-4111-8111-111111117611", Items: []shortlink.BatchCreateVisitLimitItem{{TargetURL: "https://example.org/cap76", Tags: []string{}, MaxVisits: cap}}}
			result, err := shortlink.NewService(nil, nil).BatchCreateWithVisitLimits(t.Context(), auth.CurrentUser{}, input)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
			require.Zero(t, result)
		})
	}
}
