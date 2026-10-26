package insights_test

import (
	"context"
	"encoding/csv"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestVisitExportAuthorization catches stale grants and missing per-scope permission intersections.
func TestVisitExportAuthorization(t *testing.T) {
	pool, service, owner, admin, link, _ := fixture(t)
	input := insights.VisitExportInput{ID: link}
	_, err := service.ExportVisits(t.Context(), owner, insights.VisitExportInput{ID: "bad"})
	require.ErrorIs(t, err, insights.ErrInvalidInput)
	for _, actor := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad"}, {ID: uuid.NewString()}} {
		_, err := service.ExportVisits(t.Context(), actor, input)
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
		_, err = service.AdminExportVisits(t.Context(), actor, input)
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
	for _, scope := range []struct {
		actor auth.CurrentUser
		group string
		keys  []string
		admin bool
	}{
		{owner, "user", []string{"short_link:export_visits", "short_link:read_visits", "short_link:read_own"}, false},
		{admin, "admin", []string{"short_link:export_visits", "short_link:read_visits", "admin:access", "short_link:read_all"}, true},
	} {
		for _, key := range scope.keys {
			t.Run(scope.group+key, func(t *testing.T) {
				var original []byte
				require.NoError(t, pool.QueryRow(t.Context(), `select permissions from user_group where key=$1`, scope.group).Scan(&original))
				t.Cleanup(func() {
					_, e := pool.Exec(context.Background(), `update user_group set permissions=$1 where key=$2`, original, scope.group)
					require.NoError(t, e)
				})
				_, e := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key=$2`, key, scope.group)
				require.NoError(t, e)
				if scope.admin {
					_, e = service.AdminExportVisits(t.Context(), scope.actor, input)
				} else {
					_, e = service.ExportVisits(t.Context(), scope.actor, input)
				}
				require.ErrorIs(t, e, insights.ErrPermissionDenied)
			})
		}
	}
	_, err = service.ExportVisits(t.Context(), admin, input)
	require.ErrorIs(t, err, insights.ErrLinkMissing)
	_, err = service.AdminExportVisits(t.Context(), admin, input)
	require.NoError(t, err)
	for _, sql := range []string{`update app_user set status='disabled' where username='owner'`, `update app_user set status='active',deleted_at=now() where username='owner'`, `update app_user set deleted_at=null,group_id=(select id from user_group where key='guest') where username='owner'`} {
		_, err = pool.Exec(t.Context(), sql)
		require.NoError(t, err)
		_, err = service.ExportVisits(t.Context(), owner, input)
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
		_, err = service.AdminExportVisits(t.Context(), owner, input)
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
	_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, link)
	require.NoError(t, err)
	_, err = service.AdminExportVisits(t.Context(), admin, input)
	require.ErrorIs(t, err, insights.ErrLinkMissing)
}

// exportedCells validates the public CSV rather than mirroring the encoder.
func exportedCells(t *testing.T, result insights.VisitExport) [][]string {
	t.Helper()
	require.Equal(t, "text/csv;charset=utf-8", result.ContentType)
	require.True(t, strings.HasPrefix(result.Content, "\ufeff"))
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Equal(t, []string{"short_link_id", "start_date", "end_date", "time_zone", "event_id", "occurred_at", "referrer_host", "device_type", "browser_family", "os_family", "country_code"}, rows[0])
	return rows
}

// TestVisitExportFiltering catches range leakage, unstable UUID ties and exporting unsuccessful events.
func TestVisitExportFiltering(t *testing.T) {
	pool, service, owner, _, link, today := fixture(t)
	for i := 1; i <= 3; i++ {
		visit(t, pool, fmt.Sprintf("00000000-0000-0000-0000-%012d", i), link, today, "desktop", "CN")
	}
	visit(t, pool, uuid.NewString(), link, today.Add(-time.Microsecond), "", "")
	_, err := pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) values(gen_random_uuid(),$1,'redirect_blocked',$2)`, link, today)
	require.NoError(t, err)
	input := insights.VisitExportInput{ID: link, RangeInput: insights.RangeInput{StartDate: today.Format(time.DateOnly), EndDate: today.Format(time.DateOnly)}, DeviceType: "desktop", CountryCode: "CN"}
	result, err := service.ExportVisits(t.Context(), owner, input)
	require.NoError(t, err)
	rows := exportedCells(t, result)
	require.Len(t, rows, 4)
	require.Equal(t, "00000000-0000-0000-0000-000000000003", rows[1][4])
	require.Equal(t, "00000000-0000-0000-0000-000000000001", rows[3][4])
	input.RangeInput = insights.RangeInput{}
	input.DeviceType = "unknown"
	input.CountryCode = "unknown"
	result, err = service.ExportVisits(t.Context(), owner, input)
	require.NoError(t, err)
	require.Len(t, exportedCells(t, result), 2)
}

// TestVisitExportCSV catches privacy leaks, formula injection, UTC precision and missing CSV quoting.
func TestVisitExportCSV(t *testing.T) {
	pool, service, owner, _, link, today := fixture(t)
	at := today.Add(123456 * time.Microsecond)
	id := uuid.NewString()
	visit(t, pool, id, link, at, "", "")
	_, err := pool.Exec(t.Context(), `update short_link_event set referrer_host=$1,browser_family='chrome',os_family='windows' where id=$2`, " 雪,\"山\"", id)
	require.NoError(t, err)
	result, err := service.ExportVisits(t.Context(), owner, insights.VisitExportInput{ID: link})
	require.NoError(t, err)
	rows := exportedCells(t, result)
	require.Len(t, rows, 2)
	require.Equal(t, at.Format(time.RFC3339Nano), rows[1][5])
	require.Equal(t, " 雪,\"山\"", rows[1][6])
	require.Empty(t, rows[1][7])
	require.Equal(t, "chrome", rows[1][8])
	require.Equal(t, "windows", rows[1][9])
	require.Empty(t, rows[1][10])
	require.Contains(t, result.Content, "\r\n")
	require.NotContains(t, result.Content, "target.example")
	require.Equal(t, "moeurl-visits-"+link+"-"+today.AddDate(0, 0, -6).Format(time.DateOnly)+"-"+today.Format(time.DateOnly)+".csv", result.FileName)
	for _, value := range []string{"=1", " +1", "\u2003-1", "@SUM(1)", "\tunsafe", "\runsafe", "\nunsafe"} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=$1 where id=$2`, value, id)
		require.NoError(t, err)
		result, err = service.ExportVisits(t.Context(), owner, insights.VisitExportInput{ID: link})
		require.NoError(t, err)
		// encoding/csv's CRLF mode discards bare CR and converts LF to CRLF.
		require.Equal(t, "'"+strings.ReplaceAll(value, "\r", ""), exportedCells(t, result)[1][6])
	}
}

// TestVisitExportLimits exercises the actual database budgets, including the 1001st-row sentinel.
func TestVisitExportLimits(t *testing.T) {
	pool, service, owner, _, link, today := fixture(t)
	input := insights.VisitExportInput{ID: link}
	result, err := service.ExportVisits(t.Context(), owner, input)
	require.NoError(t, err)
	require.Len(t, exportedCells(t, result), 1)
	_, err = pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),$1,'redirect_response_sent',$2 from generate_series(1,1000)`, link, today)
	require.NoError(t, err)
	result, err = service.ExportVisits(t.Context(), owner, input)
	require.NoError(t, err)
	require.Len(t, exportedCells(t, result), 1001)
	visit(t, pool, uuid.NewString(), link, today, "", "")
	result, err = service.ExportVisits(t.Context(), owner, input)
	require.ErrorIs(t, err, insights.ErrVisitExportLimit)
	require.Empty(t, result.Content)
	rowOverflow, err := sqlc.New(pool).ExportInsightVisits(t.Context(), sqlc.ExportInsightVisitsParams{ShortLinkID: link, RangeStart: pgtype.Timestamptz{Time: today, Valid: true}, RangeEnd: pgtype.Timestamptz{Time: today.AddDate(0, 0, 1), Valid: true}})
	require.NoError(t, err)
	require.Len(t, rowOverflow, 1)
	require.True(t, rowOverflow[0].LimitExceeded)
	require.Empty(t, rowOverflow[0].ID)
	require.Empty(t, rowOverflow[0].ReferrerHost)
	_, err = pool.Exec(t.Context(), `delete from short_link_event where short_link_id=$1`, link)
	require.NoError(t, err)
	visit(t, pool, uuid.NewString(), link, today, "", "")
	for _, value := range []string{strings.Repeat("x", 8*1024*1024+1), strings.Repeat("\"", 4*1024*1024)} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=$1 where short_link_id=$2`, value, link)
		require.NoError(t, err)
		result, err = service.ExportVisits(t.Context(), owner, input)
		require.ErrorIs(t, err, insights.ErrVisitExportLimit)
		require.Empty(t, result.Content)
	}
	// Direct SQL verifies the raw budget independently of CSV expansion and overhead.
	query := sqlc.New(pool)
	params := sqlc.ExportInsightVisitsParams{ShortLinkID: link, RangeStart: pgtype.Timestamptz{Time: today, Valid: true}, RangeEnd: pgtype.Timestamptz{Time: today.AddDate(0, 0, 1), Valid: true}}
	for _, size := range []int{8388608, 8388609} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('x',$1) where short_link_id=$2`, size, link)
		require.NoError(t, err)
		rows, err := query.ExportInsightVisits(t.Context(), params)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		if size == 8388608 {
			require.False(t, rows[0].LimitExceeded)
			require.Len(t, rows[0].ReferrerHost, size)
		} else {
			require.True(t, rows[0].LimitExceeded)
			require.Empty(t, rows[0].ID)
			require.Empty(t, rows[0].ReferrerHost)
			require.Empty(t, rows[0].DeviceType)
			require.Empty(t, rows[0].BrowserFamily)
			require.Empty(t, rows[0].OsFamily)
			require.Empty(t, rows[0].CountryCode)
		}
	}
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=null where short_link_id=$1`, link)
	require.NoError(t, err)
	baseline, err := service.ExportVisits(t.Context(), owner, input)
	require.NoError(t, err)
	for _, extra := range []int{0, 1} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('x',$1) where short_link_id=$2`, 8388608-len(baseline.Content)+extra, link)
		require.NoError(t, err)
		result, err = service.ExportVisits(t.Context(), owner, input)
		if extra == 0 {
			require.NoError(t, err)
			require.Len(t, result.Content, 8388608)
		} else {
			require.ErrorIs(t, err, insights.ErrVisitExportLimit)
			require.Empty(t, result.Content)
		}
	}
}
