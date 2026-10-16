package shortlink_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestStatisticsDateRanges verifies inclusive UTC dates and scoped dimensions in an isolated database.
func TestStatisticsDateRanges(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "range-owner", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "range1", "https://example.com", "active", false)
	today := time.Now().UTC().Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, -10)
	end := start.AddDate(0, 0, 2)
	for _, visit := range []struct {
		at        time.Time
		dimension string
		event     string
	}{
		{start.Add(-time.Microsecond), "outside", "redirect_response_sent"},
		{start, "included", "redirect_response_sent"},
		{end.Add(-time.Microsecond), "included", "redirect_response_sent"},
		{end, "outside", "redirect_response_sent"},
		{start, "ignored", "redirect_blocked"},
		{today, "today", "redirect_response_sent"},
		{today.AddDate(0, 0, 1), "future", "redirect_response_sent"},
	} {
		_, err := pool.Exec(ctx, `insert into short_link_event (id,short_link_id,event_type,created_at,referrer_host,device_type,country_code) values (gen_random_uuid(),$1,$2,$3,$4,$4,$4)`, linkID, visit.event, visit.at, visit.dimension)
		require.NoError(t, err)
	}
	config := pool.Config()
	config.ConnConfig.RuntimeParams["timezone"] = "America/Los_Angeles"
	zonePool, err := pgxpool.NewWithConfig(ctx, config)
	require.NoError(t, err)
	t.Cleanup(zonePool.Close)
	service := shortlink.NewService(zonePool, permission.NewService())
	input := shortlink.StatisticsInput{ID: linkID, StartDate: start.Format(time.DateOnly), EndDate: end.AddDate(0, 0, -1).Format(time.DateOnly)}
	for _, admin := range []bool{false, true} {
		var result shortlink.StatisticsResult
		if admin {
			result, err = service.AdminStatistics(ctx, auth.CurrentUser{ID: owner.ID, GroupKey: "admin"}, input)
		} else {
			result, err = service.Statistics(ctx, owner, input)
		}
		require.NoError(t, err)
		require.Equal(t, int64(6), result.Stats.VisitCount)
		require.Equal(t, int64(1), result.Stats.TodayVisitCount)
		require.True(t, result.Stats.LastVisitedAt.Equal(today.AddDate(0, 0, 1)))
		require.Equal(t, int64(2), result.Stats.RangeVisitCount)
		require.Equal(t, shortlink.AnalyticsRange{StartDate: input.StartDate, EndDate: input.EndDate, TimeZone: "UTC"}, result.Range)
		require.Equal(t, []shortlink.AnalyticsTrendPoint{{Date: input.StartDate, VisitCount: 1}, {Date: input.EndDate, VisitCount: 1}}, result.Stats.Trend)
		for _, dimensions := range [][]shortlink.AnalyticsDimension{result.Stats.Referrers, result.Stats.Devices, result.Stats.Countries} {
			require.Equal(t, []shortlink.AnalyticsDimension{{Value: "included", VisitCount: 2}}, dimensions)
		}
	}
	for _, days := range []string{"7", "30", "90"} {
		result, err := service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: linkID, Days: days})
		require.NoError(t, err)
		require.Equal(t, today.Format(time.DateOnly), result.Range.EndDate)
		var count int64
		for _, point := range result.Stats.Trend {
			count += point.VisitCount
		}
		require.Equal(t, count, result.Stats.RangeVisitCount)
	}
	// Validation and visibility must finish before any aggregate query can run.
	_, err = pool.Exec(ctx, `drop table short_link_event`)
	require.NoError(t, err)
	for _, admin := range []bool{false, true} {
		if admin {
			_, err = service.AdminStatistics(ctx, auth.CurrentUser{ID: owner.ID, GroupKey: "admin"}, shortlink.StatisticsInput{ID: linkID, Days: "1"})
		} else {
			_, err = service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: linkID, Days: "1"})
		}
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	for _, endpoint := range []struct {
		path string
		user auth.CurrentUser
	}{
		{"/api/v1/short-link/statistics", owner},
		{"/api/v1/admin/short-link/statistics", auth.CurrentUser{ID: owner.ID, Username: "admin", GroupKey: "admin"}},
	} {
		router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{user: endpoint.user}, ShortLink: service})
		for _, query := range []string{"days=1", "days=7&startDate=2026-01-01&endDate=2026-01-02", "startDate=2026-01-01", "endDate=2026-01-02", "startDate=2026-02-30&endDate=2026-03-01", "startDate=2026-01-02&endDate=2026-01-01", "startDate=9999-01-01&endDate=9999-01-02", "startDate=2026-01-01&endDate=2026-12-31"} {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, endpoint.path+"?id="+linkID+"&"+query, nil)
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "range-session"})
			router.ServeHTTP(response, request)
			assertBusinessCode(t, response, http.StatusOK, 100001)
		}
	}
}
