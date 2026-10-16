package shortlink

import (
	"bytes"
	"context"
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
)

// StatisticsExport describes an authorized CSV file without exposing raw events or private link fields.
type StatisticsExport struct {
	FileName    string `json:"fileName"`
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}

// ExportStatistics rechecks export and personal read permissions before generating an owner's CSV.
func (s *Service) ExportStatistics(ctx context.Context, user auth.CurrentUser, input StatisticsInput) (StatisticsExport, error) {
	if _, err := s.authorize(ctx, user, permission.ShortLinkExportStatistics); err != nil {
		return StatisticsExport{}, err
	}
	result, err := s.Statistics(ctx, user, input)
	if err != nil {
		return StatisticsExport{}, err
	}
	return statisticsExport(result), nil
}

// AdminExportStatistics rechecks export and administrative read permissions before generating a CSV.
func (s *Service) AdminExportStatistics(ctx context.Context, user auth.CurrentUser, input StatisticsInput) (StatisticsExport, error) {
	if _, err := s.authorize(ctx, user, permission.ShortLinkExportStatistics); err != nil {
		return StatisticsExport{}, err
	}
	result, err := s.AdminStatistics(ctx, user, input)
	if err != nil {
		return StatisticsExport{}, err
	}
	return statisticsExport(result), nil
}

// statisticsExport serializes only anonymous aggregates in a stable spreadsheet-compatible CSV schema.
func statisticsExport(result StatisticsResult) StatisticsExport {
	var buffer bytes.Buffer
	buffer.WriteString("\ufeff")
	writer := csv.NewWriter(&buffer)
	writer.UseCRLF = true
	write := func(section, key, value, count string) {
		_ = writer.Write([]string{section, key, csvText(value), count})
	}
	write("section", "key", "value", "visit_count")
	write("metadata", "short_link", result.ShortLink.URL, "")
	write("metadata", "start_date", result.Range.StartDate, "")
	write("metadata", "end_date", result.Range.EndDate, "")
	write("metadata", "time_zone", "UTC", "")
	write("summary", "range_visit_count", "", strconv.FormatInt(result.Stats.RangeVisitCount, 10))
	write("summary", "lifetime_visit_count", "", strconv.FormatInt(result.Stats.VisitCount, 10))
	write("summary", "today_visit_count", "", strconv.FormatInt(result.Stats.TodayVisitCount, 10))
	last := ""
	if result.Stats.LastVisitedAt != nil {
		last = result.Stats.LastVisitedAt.UTC().Format(time.RFC3339Nano)
	}
	write("summary", "last_visited_at", last, "")
	for _, point := range result.Stats.Trend {
		write("trend", "date", point.Date, strconv.FormatInt(point.VisitCount, 10))
	}
	for _, group := range []struct {
		section, key string
		dimensions   []AnalyticsDimension
	}{
		{"referrer", "host", result.Stats.Referrers}, {"device", "type", result.Stats.Devices}, {"country", "code", result.Stats.Countries},
	} {
		for _, dimension := range group.dimensions {
			write(group.section, group.key, dimension.Value, strconv.FormatInt(dimension.VisitCount, 10))
		}
	}
	// bytes.Buffer writes cannot fail; flushing completes the standard CSV writer's buffered output.
	writer.Flush()
	return StatisticsExport{FileName: fmt.Sprintf("moeurl-statistics-%s-%s-%s.csv", result.ShortLink.Slug, result.Range.StartDate, result.Range.EndDate), ContentType: "text/csv;charset=utf-8", Content: buffer.String()}
}

// csvText neutralizes formula and control prefixes independently of CSV quoting.
func csvText(value string) string {
	trimmed := strings.TrimLeftFunc(value, unicode.IsSpace)
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") || (len(trimmed) > 0 && strings.ContainsRune("=+-@", rune(trimmed[0]))) {
		return "'" + value
	}
	return value
}
