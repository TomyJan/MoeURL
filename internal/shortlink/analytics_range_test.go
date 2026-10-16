package shortlink

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestNormalizeAnalyticsRange verifies UTC presets, strict dates, and inclusive bounds.
func TestNormalizeAnalyticsRange(t *testing.T) {
	now := time.Date(2026, 10, 15, 1, 0, 0, 0, time.FixedZone("UTC+8", 8*3600))
	for _, test := range []struct {
		name       string
		input      StatisticsInput
		start, end string
	}{
		{"default", StatisticsInput{}, "2026-10-08", "2026-10-14"},
		{"seven", StatisticsInput{Days: "7"}, "2026-10-08", "2026-10-14"},
		{"thirty", StatisticsInput{Days: "30"}, "2026-09-15", "2026-10-14"},
		{"ninety", StatisticsInput{Days: "90"}, "2026-07-17", "2026-10-14"},
		{"single", StatisticsInput{StartDate: "2026-10-14", EndDate: "2026-10-14"}, "2026-10-14", "2026-10-14"},
		{"ninety custom", StatisticsInput{StartDate: "2026-07-17", EndDate: "2026-10-14"}, "2026-07-17", "2026-10-14"},
		{"leap", StatisticsInput{StartDate: "2024-02-29", EndDate: "2024-03-01"}, "2024-02-29", "2024-03-01"},
	} {
		t.Run(test.name, func(t *testing.T) {
			r, err := normalizeAnalyticsRange(test.input, now)
			require.NoError(t, err)
			require.Equal(t, AnalyticsRange{StartDate: test.start, EndDate: test.end, TimeZone: "UTC"}, r.response)
			require.Equal(t, test.start+"T00:00:00Z", r.start.Format(time.RFC3339))
			require.Equal(t, test.end, r.end.AddDate(0, 0, -1).Format(time.DateOnly))
			require.Equal(t, "2026-10-14", r.today.Format(time.DateOnly))
		})
	}
	for _, input := range []StatisticsInput{
		{Days: "1"}, {Days: "07"}, {Days: " 7"}, {Days: "31"},
		{Days: "7", StartDate: "2026-10-14", EndDate: "2026-10-14"},
		{StartDate: "2026-10-14"}, {EndDate: "2026-10-14"},
		{StartDate: "2026-1-01", EndDate: "2026-10-14"},
		{StartDate: "2026-02-29", EndDate: "2026-10-14"},
		{StartDate: "2026-10-14", EndDate: "2026-10-15"},
		{StartDate: "2026-10-14", EndDate: "2026-02-30"},
		{StartDate: "2026-10-14", EndDate: "2026-10-13"},
		{StartDate: "2026-07-16", EndDate: "2026-10-14"},
	} {
		_, err := normalizeAnalyticsRange(input, now)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}

// TestNormalizeAnalyticsRangeAcrossUTCMidnight keeps explicit dates fixed while today's window advances.
func TestNormalizeAnalyticsRangeAcrossUTCMidnight(t *testing.T) {
	input := StatisticsInput{StartDate: "2026-10-14", EndDate: "2026-10-15"}
	midnight := time.Date(2026, 10, 16, 0, 0, 0, 0, time.UTC)
	before, err := normalizeAnalyticsRange(input, midnight.Add(-time.Nanosecond))
	require.NoError(t, err)
	after, err := normalizeAnalyticsRange(input, midnight)
	require.NoError(t, err)
	require.Equal(t, before.response, after.response)
	require.Equal(t, before.start, after.start)
	require.Equal(t, before.end, after.end)
	require.Equal(t, midnight.AddDate(0, 0, -1), before.today)
	require.Equal(t, midnight, after.today)
}
