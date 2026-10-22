package insights

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestInsightInputValidation catches ambiguous query strings, unsafe cursors and unbounded reads.
func TestInsightInputValidation(t *testing.T) {
	now := time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC)
	for _, test := range []struct {
		input      RangeInput
		start, end string
	}{
		{RangeInput{}, "2026-10-16", "2026-10-22"}, {RangeInput{Days: "7"}, "2026-10-16", "2026-10-22"}, {RangeInput{Days: "30"}, "2026-09-23", "2026-10-22"}, {RangeInput{Days: "90"}, "2026-07-25", "2026-10-22"}, {RangeInput{StartDate: "2024-02-29", EndDate: "2024-03-01"}, "2024-02-29", "2024-03-01"},
	} {
		r, err := normalizeRange(test.input, now)
		require.NoError(t, err)
		require.Equal(t, Range{test.start, test.end, "UTC"}, r.response)
		require.Equal(t, test.start+"T00:00:00Z", r.start.Format(time.RFC3339))
		require.Equal(t, test.end, r.end.AddDate(0, 0, -1).Format(time.DateOnly))
	}
	for _, input := range []RangeInput{{Days: "1"}, {Days: "07"}, {Days: " 7"}, {StartDate: "2026-10-22"}, {EndDate: "2026-10-22"}, {Days: "7", StartDate: "2026-10-22", EndDate: "2026-10-22"}, {StartDate: "bad", EndDate: "2026-10-22"}, {StartDate: "2026-10-22", EndDate: "bad"}, {StartDate: "2026-10-23", EndDate: "2026-10-23"}, {StartDate: "2026-10-22", EndDate: "2026-10-21"}, {StartDate: "2026-07-24", EndDate: "2026-10-22"}} {
		_, err := normalizeRange(input, now)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, raw := range []string{"days=", "days=7&days=30", "id=x&id=y", "cursor=", "pageSize=", "countryCode=", "deviceType=", "startDate=", "endDate=", "unexpected=x", "days=%zz", "pageSize=0", "pageSize=-1", "pageSize=101", "pageSize=2147483648", "pageSize=a", "pageSize=01", "pageSize=%2B1"} {
		_, err := parseQuery(raw, true)
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	_, err := parseQuery("id=x", false)
	require.ErrorIs(t, err, ErrInvalidInput)
	input, err := parseQuery("id=00000000-0000-0000-0000-000000000001&pageSize=100&days=7&deviceType=desktop&countryCode=US", true)
	require.NoError(t, err)
	require.Equal(t, int32(100), input.PageSize)
	_, _, err = validateVisits(input)
	require.NoError(t, err)
	for _, invalid := range []VisitInput{{ID: "bad"}, {ID: input.ID, PageSize: -1}, {ID: input.ID, PageSize: 101}, {ID: input.ID, DeviceType: "Desktop"}, {ID: input.ID, CountryCode: "us"}, {ID: input.ID, CountryCode: "U1"}, {ID: input.ID, CountryCode: "USA"}, {ID: input.ID, RangeInput: RangeInput{Days: "1"}}} {
		_, _, err := validateVisits(invalid)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, raw := range []string{"!", strings.Repeat("a", 513), base64.URLEncoding.EncodeToString([]byte("{}")), "e31", encode(`[]`), encode(`{`), encode(`{"`), encode(`{"id"`), encode(`{"no":"x"}`), encode(`{"id":"x","id":"y"}`), encode(`{"id":`), encode(`{"id":"x"]`), encode(`{} {}`), encode(`{} garbage`), encode(`{"id":"x"}`), encode(`{"createdAt":"bad","id":"00000000-0000-0000-0000-000000000001"}`), encode(`{"createdAt":"2026-10-22T00:00:00Z","id":3}`), encode(`{"createdAt":null,"id":"00000000-0000-0000-0000-000000000001"}`), encode(`{"createdAt":"2026-10-22T00:00:00Z","id":"bad"}`)} {
		_, err := decodeCursor(raw)
		require.ErrorIs(t, err, ErrInvalidInput, raw)
	}
	cursor, err := decodeCursor(encode(`{"createdAt":"2026-10-22T00:00:00.123456Z","id":"00000000-0000-0000-0000-000000000001"}`))
	require.NoError(t, err)
	require.Equal(t, "2026-10-22T00:00:00.123456Z", cursor.CreatedAt.Format(time.RFC3339Nano))
	require.Equal(t, "00000000-0000-0000-0000-000000000001", cursor.ID)
}

// encode constructs malicious wire inputs independently of the production cursor encoder.
func encode(raw string) string { return base64.RawURLEncoding.EncodeToString([]byte(raw)) }

// TestInsightUTCMidnight ensures the server's local zone cannot shift calendar windows.
func TestInsightUTCMidnight(t *testing.T) {
	now := time.Date(2026, 10, 22, 1, 0, 0, 0, time.FixedZone("east", 8*3600))
	r, err := normalizeRange(RangeInput{}, now)
	require.NoError(t, err)
	require.Equal(t, "2026-10-21", r.response.EndDate)
	r, err = normalizeRange(RangeInput{}, time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC))
	require.NoError(t, err)
	require.Equal(t, "2026-10-22", r.response.EndDate)
}

// TestInsightRejectsYearZero prevents unsupported PostgreSQL dates becoming infrastructure errors.
func TestInsightRejectsYearZero(t *testing.T) {
	_, err := normalizeRange(RangeInput{StartDate: "0000-01-01", EndDate: "0000-01-02"}, time.Now())
	require.ErrorIs(t, err, ErrInvalidInput)
	_, err = decodeCursor(encode(`{"createdAt":"0000-01-01T00:00:00Z","id":"00000000-0000-0000-0000-000000000001"}`))
	require.ErrorIs(t, err, ErrInvalidInput)
}
