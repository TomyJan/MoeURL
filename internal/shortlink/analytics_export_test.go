package shortlink

import (
	"encoding/csv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestStatisticsCSVContract checks actual CSV cells, stable order and private-field isolation.
func TestStatisticsCSVContract(t *testing.T) {
	at := time.Date(2026, 10, 15, 12, 34, 56, 123, time.FixedZone("east", 8*3600))
	input := StatisticsResult{
		ShortLink: ShortLink{Slug: "export1", URL: "https://s.example/export1", TargetURL: "https://private.example/secret", Title: "private-title", Tags: []string{"private-tag"}},
		Range:     AnalyticsRange{StartDate: "2026-10-14", EndDate: "2026-10-15", TimeZone: "UTC"},
		Stats: AnalyticsStats{RangeVisitCount: 3, VisitCount: 42, TodayVisitCount: 2, LastVisitedAt: &at,
			Trend:     []AnalyticsTrendPoint{{Date: "2026-10-14", VisitCount: 0}, {Date: "2026-10-15", VisitCount: 3}},
			Referrers: []AnalyticsDimension{{Value: "a,\"b\"\nc.example", VisitCount: 1}, {Value: "other", VisitCount: 2}},
			Devices:   []AnalyticsDimension{{Value: "desktop", VisitCount: 3}}, Countries: []AnalyticsDimension{{Value: "SG", VisitCount: 3}}},
	}
	got := statisticsExport(input)
	require.Equal(t, "moeurl-statistics-export1-2026-10-14-2026-10-15.csv", got.FileName)
	require.Equal(t, "text/csv;charset=utf-8", got.ContentType)
	require.True(t, strings.HasPrefix(got.Content, "\ufeffsection,key,value,visit_count\r\n"))
	for _, secret := range []string{"private.example", "private-title", "private-tag"} {
		require.NotContains(t, got.Content, secret)
	}
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(got.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Equal(t, [][]string{
		{"section", "key", "value", "visit_count"},
		{"metadata", "short_link", input.ShortLink.URL, ""}, {"metadata", "start_date", "2026-10-14", ""}, {"metadata", "end_date", "2026-10-15", ""}, {"metadata", "time_zone", "UTC", ""},
		{"summary", "range_visit_count", "", "3"}, {"summary", "lifetime_visit_count", "", "42"}, {"summary", "today_visit_count", "", "2"}, {"summary", "last_visited_at", "2026-10-15T04:34:56.000000123Z", ""},
		{"trend", "date", "2026-10-14", "0"}, {"trend", "date", "2026-10-15", "3"},
		{"referrer", "host", "a,\"b\"\nc.example", "1"}, {"referrer", "host", "other", "2"}, {"device", "type", "desktop", "3"}, {"country", "code", "SG", "3"},
	}, rows)
}

// TestStatisticsCSVFormulaSafety verifies Unicode whitespace and control-prefix formula protection.
func TestStatisticsCSVFormulaSafety(t *testing.T) {
	for _, value := range []string{"=1", "+1", "-1", "@cmd", " \u2003=1", "\tplain", "\rplain", "\nplain", "\u00a0+1", "", "normal", " \u2003normal", "\u2003"} {
		t.Run(value, func(t *testing.T) {
			want := value
			if value != "" && value != "normal" && value != " \u2003normal" && value != "\u2003" {
				want = "'" + value
			}
			result := statisticsExport(StatisticsResult{ShortLink: ShortLink{URL: value}, Stats: AnalyticsStats{Referrers: []AnalyticsDimension{{Value: value}}}})
			reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff")))
			rows, err := reader.ReadAll()
			require.NoError(t, err)
			// The standard CSV reader normalizes embedded CRLF as part of CSV parsing.
			require.Equal(t, strings.ReplaceAll(want, "\r", ""), strings.ReplaceAll(rows[1][2], "\r", ""))
			require.Equal(t, strings.ReplaceAll(want, "\r", ""), strings.ReplaceAll(rows[len(rows)-1][2], "\r", ""))
			require.Equal(t, []string{"summary", "last_visited_at", "", ""}, rows[8])
		})
	}
	result := statisticsExport(StatisticsResult{})
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 9)
}
