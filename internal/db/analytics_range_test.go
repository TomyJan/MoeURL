package db_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestAnalyticsRangeQueries verifies zero fill, UTC grouping, and bounded top-ten dimensions.
func TestAnalyticsRangeQueries(t *testing.T) {
	ctx := t.Context()
	pool := sqlcTestPool(t, ctx)
	owner, domain, link := uuid.New(), uuid.New(), uuid.New()
	insertSQLCShortLinkFixtures(t, ctx, pool, owner, domain, link)
	conn, err := pool.Acquire(ctx)
	require.NoError(t, err)
	defer conn.Release()
	_, err = conn.Exec(ctx, `set timezone to 'Pacific/Auckland'`)
	require.NoError(t, err)
	queries := sqlc.New(conn)
	start := time.Date(2024, 2, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 0, 90)
	for i := 0; i < 12; i++ {
		_, err = conn.Exec(ctx, `insert into short_link_event (id,short_link_id,event_type,created_at,referrer_host,device_type,country_code) values (gen_random_uuid(),$1,'redirect_response_sent',$2,$3,$3,$3)`, link, start, fmt.Sprintf("dimension%02d", i))
		require.NoError(t, err)
	}
	for _, at := range []time.Time{start.Add(-time.Microsecond), end} {
		_, err = conn.Exec(ctx, `insert into short_link_event (id,short_link_id,event_type,created_at,referrer_host,device_type,country_code) values (gen_random_uuid(),$1,'redirect_response_sent',$2,'excluded','excluded','excluded')`, link, at)
		require.NoError(t, err)
	}
	_, err = conn.Exec(ctx, `insert into short_link_event (id,short_link_id,event_type,created_at,referrer_host,device_type,country_code) values (gen_random_uuid(),$1,'redirect_blocked',$2,'excluded','excluded','excluded')`, link, start)
	require.NoError(t, err)
	params := sqlc.ListShortLinkDailyVisitsParams{ShortLinkID: uuidToPgtype(link), RangeStart: pgtype.Timestamptz{Time: start, Valid: true}, RangeEnd: pgtype.Timestamptz{Time: end, Valid: true}}
	trend, err := queries.ListShortLinkDailyVisits(ctx, params)
	require.NoError(t, err)
	require.Len(t, trend, 90)
	require.Equal(t, int64(12), trend[0].VisitCount)
	for i, point := range trend {
		require.Equal(t, start.AddDate(0, 0, i).Format(time.DateOnly), point.Day.Time.Format(time.DateOnly))
		if i > 0 {
			require.Zero(t, point.VisitCount)
		}
	}
	referrers, err := queries.ListShortLinkReferrerStats(ctx, sqlc.ListShortLinkReferrerStatsParams(params))
	require.NoError(t, err)
	devices, err := queries.ListShortLinkDeviceStats(ctx, sqlc.ListShortLinkDeviceStatsParams(params))
	require.NoError(t, err)
	countries, err := queries.ListShortLinkCountryStats(ctx, sqlc.ListShortLinkCountryStatsParams(params))
	require.NoError(t, err)
	require.Len(t, referrers, 11)
	require.Len(t, devices, 11)
	require.Len(t, countries, 11)
	require.Equal(t, "other", referrers[0].Value)
	require.Equal(t, int64(2), referrers[0].VisitCount)
	for i, row := range referrers {
		require.Equal(t, row.Value, devices[i].Value)
		require.Equal(t, row.VisitCount, devices[i].VisitCount)
		require.Equal(t, row.Value, countries[i].Value)
		require.Equal(t, row.VisitCount, countries[i].VisitCount)
	}
}
