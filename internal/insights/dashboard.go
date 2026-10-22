package insights

import (
	"context"
	"strings"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
)

// Dashboard returns global counts and bounded UTC usage aggregates from a single snapshot.
func (s *Service) Dashboard(ctx context.Context, user auth.CurrentUser, input RangeInput) (DashboardResult, error) {
	result := DashboardResult{Trend: []TrendPoint{}, TopLinks: []TopLink{}}
	err := s.read(ctx, user, input, []string{permission.AdminAccess, permission.StatisticsReadAll}, func(ctx context.Context, view snapshot) error {
		dates := view.dates
		summary, err := view.queries.GetDashboardSummary(ctx, sqlc.GetDashboardSummaryParams{TodayStart: timestamp(dates.today), TodayEnd: timestamp(dates.today.AddDate(0, 0, 1)), RangeStart: timestamp(dates.start), RangeEnd: timestamp(dates.end)})
		if err != nil {
			return err
		}
		trend, err := view.queries.ListDashboardTrend(ctx, sqlc.ListDashboardTrendParams{RangeStart: timestamp(dates.start), RangeEnd: timestamp(dates.end)})
		if err != nil {
			return err
		}
		top, err := view.queries.ListDashboardTopLinks(ctx, sqlc.ListDashboardTopLinksParams{RangeStart: timestamp(dates.start), RangeEnd: timestamp(dates.end)})
		if err != nil {
			return err
		}
		result.Summary = DashboardSummary{summary.UserCount, summary.ActiveUserCount, summary.LinkCount, summary.ActiveLinkCount, summary.TodayCreatedLinkCount, summary.TodayVisitCount, summary.RangeVisitCount}
		result.Range = dates.response
		result.GeneratedAt = view.now
		for _, row := range trend {
			result.Trend = append(result.Trend, TrendPoint{row.Day.Time.Format("2006-01-02"), row.VisitCount})
		}
		for _, row := range top {
			host := row.Host
			if !strings.HasPrefix(host, "http://") && !strings.HasPrefix(host, "https://") {
				host = "https://" + host
			}
			result.TopLinks = append(result.TopLinks, TopLink{row.ID, row.Slug, strings.TrimRight(host, "/") + "/" + row.Slug, row.Title, row.Deleted, row.VisitCount})
		}
		return nil
	})
	if err != nil {
		return DashboardResult{}, err
	}
	return result, nil
}
