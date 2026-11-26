package shortlink_test

import (
	"encoding/csv"
	"fmt"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestExportStatisticsDatabase checks live grants, ownership and the unchanged aggregate/date contract.
func TestExportStatisticsDatabase(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "export-owner", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "export1", "https://private.example/secret", "active", false)
	deletedID := insertStoredShortLink(t, ctx, pool, owner.ID, "deletedexport", "https://example.com", "active", true)
	adminGroupID := "00000000-0000-0000-0000-000000000402"
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at) values($1,'admin','admin','',$2::jsonb,true,now(),now())`, adminGroupID, permissionsJSON(t, permission.AdminPermissions))
	require.NoError(t, err)
	adminUser := insertShortLinkUserForGroup(t, ctx, pool, "export-admin", adminGroupID, uuid.NewString(), permission.GroupAdmin, permission.AdminPermissions)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	today := time.Now().UTC().Format(time.DateOnly)
	input := shortlink.StatisticsInput{ID: linkID, StartDate: today, EndDate: today}
	// Zero visits is a useful export with a continuous zero trend and no invented dimensions.
	for _, admin := range []bool{false, true} {
		actor := owner
		export := service.ExportStatistics
		if admin {
			actor = adminUser
			export = service.AdminExportStatistics
		}
		result, err := export(ctx, actor, input)
		require.NoError(t, err, "admin=%v actor=%+v", admin, actor)
		rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
		require.NoError(t, err)
		require.Len(t, rows, 10)
		require.Equal(t, []string{"trend", "date", today, "0"}, rows[9])
		require.Equal(t, []string{"summary", "last_visited_at", "", ""}, rows[8])
		for _, bad := range []shortlink.StatisticsInput{
			{ID: linkID, Days: "1"}, {ID: linkID, StartDate: "2026-02-30", EndDate: today},
			{ID: linkID, StartDate: today}, {ID: linkID, StartDate: today, EndDate: "9999-01-01"},
			{ID: linkID, StartDate: "2026-01-01", EndDate: "2026-12-31"},
		} {
			_, err := export(ctx, actor, bad)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		}
		_, err = export(ctx, actor, shortlink.StatisticsInput{ID: "invalid"})
		require.ErrorIs(t, err, shortlink.ErrInvalidShortLinkID)
		for _, missing := range []string{uuid.NewString(), deletedID} {
			_, err := export(ctx, actor, shortlink.StatisticsInput{ID: missing})
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
		}
	}
	other := insertShortLinkUserForGroup(t, ctx, pool, "export-other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), permission.GroupUser, permission.UserPermissions)
	_, err = service.ExportStatistics(ctx, other, input)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	_, err = service.ExportStatistics(ctx, auth.CurrentUser{GroupKey: "guest"}, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	visitTime := "'" + today + "T12:00:00Z'::timestamptz"
	insertStoredAnalyticsVisit(t, ctx, pool, linkID, "search.example", "desktop", "SG", visitTime)
	for _, admin := range []bool{false, true} {
		actor := owner
		export := service.ExportStatistics
		statistics := service.Statistics
		if admin {
			actor = adminUser
			export = service.AdminExportStatistics
			statistics = service.AdminStatistics
		}
		result, err := export(ctx, actor, input)
		require.NoError(t, err)
		expected, err := statistics(ctx, actor, input)
		require.NoError(t, err)
		rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
		require.NoError(t, err)
		require.Equal(t, int64(1), expected.Stats.RangeVisitCount)
		require.Equal(t, []string{"summary", "range_visit_count", "", "1"}, rows[5])
		require.Equal(t, []string{"summary", "lifetime_visit_count", "", "1"}, rows[6])
		require.Equal(t, []string{"referrer", "host", expected.Stats.Referrers[0].Value, "1"}, rows[10])
		require.NotContains(t, result.Content, "private.example")
	}
	// The download preserves the existing top ten and other buckets without regrouping them.
	for index := range 11 {
		value := fmt.Sprintf("dimension%02d", index)
		insertStoredAnalyticsVisit(t, ctx, pool, linkID, value+".example", value, value, visitTime)
	}
	expected, err := service.Statistics(ctx, owner, input)
	require.NoError(t, err)
	exported, err := service.ExportStatistics(ctx, owner, input)
	require.NoError(t, err)
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	for _, group := range []struct {
		section, key string
		values       []shortlink.AnalyticsDimension
	}{
		{"referrer", "host", expected.Stats.Referrers}, {"device", "type", expected.Stats.Devices}, {"country", "code", expected.Stats.Countries},
	} {
		var actual [][]string
		var want [][]string
		for _, row := range rows {
			if row[0] == group.section {
				actual = append(actual, row)
			}
		}
		for _, dimension := range group.values {
			want = append(want, []string{group.section, group.key, dimension.Value, strconv.FormatInt(dimension.VisitCount, 10)})
		}
		require.Equal(t, want, actual)
	}
	require.Len(t, expected.Stats.Referrers, 11)
	require.Contains(t, expected.Stats.Referrers, shortlink.AnalyticsDimension{Value: "other", VisitCount: 2})
	// Client-provided permission lists never override the current database grant.
	for _, test := range []struct {
		key, remove string
		admin       bool
	}{
		{"user", permission.ShortLinkExportStatistics, false}, {"user", permission.ShortLinkReadOwn, false},
		{"admin", permission.ShortLinkExportStatistics, true}, {"admin", permission.ShortLinkReadAll, true}, {"admin", permission.AdminAccess, true},
	} {
		_, err := pool.Exec(ctx, `update user_group set permissions=permissions-$1 where key=$2`, test.remove, test.key)
		require.NoError(t, err)
		actor := owner
		if test.admin {
			actor = adminUser
			_, err = service.AdminExportStatistics(ctx, actor, input)
		} else {
			_, err = service.ExportStatistics(ctx, actor, input)
		}
		wantErr := error(shortlink.ErrPermissionDenied)
		if test.admin && (test.remove == permission.ShortLinkReadAll || test.remove == permission.AdminAccess) {
			wantErr = permission.ErrProtectedPermission
		}
		require.ErrorIs(t, err, wantErr)
		_, err = pool.Exec(ctx, `update user_group set permissions=permissions || jsonb_build_array($1::text) where key=$2`, test.remove, test.key)
		require.NoError(t, err)
	}
	// A real aggregate failure is propagated instead of returning a partial file.
	_, err = pool.Exec(ctx, `drop table short_link_event`)
	require.NoError(t, err)
	_, err = service.ExportStatistics(ctx, owner, input)
	require.Error(t, err)
	require.NotErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = service.AdminExportStatistics(ctx, adminUser, input)
	require.Error(t, err)
	pool.Close()
	_, err = service.ExportStatistics(ctx, owner, input)
	require.Error(t, err)
	_, err = service.AdminExportStatistics(ctx, adminUser, input)
	require.Error(t, err)
}
