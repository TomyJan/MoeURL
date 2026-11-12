package insights_test

import (
	"context"
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

// TestGlobalVisitExportAuthorization catches stale session grants and each missing database grant.
func TestGlobalVisitExportAuthorization(t *testing.T) {
	pool, service, owner, admin, _, _ := fixture(t)
	for _, actor := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad"}, {ID: uuid.NewString()}, owner, {ID: owner.ID, GroupKey: "admin"}} {
		result, err := service.ExportGlobalVisits(t.Context(), actor, insights.RangeInput{})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
		require.Empty(t, result.Content)
	}
	for _, key := range []string{"admin:access", "statistics:read_all", "statistics:export_visits", "short_link:read_all", "short_link:read_visits"} {
		t.Run(key, func(t *testing.T) {
			var original []byte
			require.NoError(t, pool.QueryRow(t.Context(), `select permissions from user_group where key='admin'`).Scan(&original))
			t.Cleanup(func() {
				_, err := pool.Exec(context.Background(), `update user_group set permissions=$1 where key='admin'`, original)
				require.NoError(t, err)
			})
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='admin'`, key)
			require.NoError(t, err)
			result, err := service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{})
			require.ErrorIs(t, err, insights.ErrPermissionDenied)
			require.Empty(t, result.Content)
		})
	}
	_, err := service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{})
	require.NoError(t, err)
	for _, statement := range []string{`update app_user set status='disabled' where username='admin'`, `update app_user set status='active',deleted_at=now() where username='admin'`, `update app_user set deleted_at=null,group_id=(select id from user_group where key='guest') where username='admin'`} {
		_, err = pool.Exec(t.Context(), statement)
		require.NoError(t, err)
		result, err := service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
		require.Empty(t, result.Content)
	}
}

// TestGlobalVisitExportRecords catches a single-owner restriction, deleted history loss and UTC leakage.
func TestGlobalVisitExportRecords(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	deleted := newLink(t, pool, admin.ID, "deletedglobal", true)
	start := today.AddDate(0, 0, -1)
	for i, id := range []string{link, deleted} {
		visit(t, pool, fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1), id, start.Add(123456*time.Microsecond), "", "")
	}
	visit(t, pool, uuid.NewString(), link, start.Add(-time.Microsecond), "", "")
	visit(t, pool, uuid.NewString(), link, today.AddDate(0, 0, 1), "", "")
	_, err := pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) values(gen_random_uuid(),$1,'redirect_blocked',$2)`, link, start)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update short_link set owner_id=$1 where id=$2`, admin.ID, link)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host='=1',device_type=' +2',browser_family='chrome',os_family='linux',country_code='CN' where id='00000000-0000-0000-0000-000000000002'`)
	require.NoError(t, err)
	input := insights.RangeInput{StartDate: start.Format(time.DateOnly), EndDate: today.Format(time.DateOnly)}
	result, err := service.ExportGlobalVisits(t.Context(), admin, input)
	require.NoError(t, err)
	rows := exportedCells(t, result)
	require.Len(t, rows, 3)
	require.Equal(t, deleted, rows[1][0])
	require.Equal(t, link, rows[2][0])
	require.Equal(t, "00000000-0000-0000-0000-000000000002", rows[1][4])
	require.Equal(t, start.Add(123456*time.Microsecond).Format(time.RFC3339Nano), rows[1][5])
	require.Equal(t, []string{"'=1", "' +2", "chrome", "linux", "CN"}, rows[1][6:])
	require.Equal(t, []string{input.StartDate, input.EndDate, "UTC"}, rows[1][1:4])
	require.Equal(t, "moeurl-site-visits-"+input.StartDate+"-"+input.EndDate+".csv", result.FileName)
	require.NotContains(t, result.Content, owner.ID)
	require.NotContains(t, result.Content, admin.ID)
	require.NotContains(t, result.Content, "target.example")
	require.Contains(t, result.Content, "\r\n")
	for _, days := range []string{"", "7", "30", "90"} {
		_, err = service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{Days: days})
		require.NoError(t, err)
	}
}

// TestGlobalVisitExportLimits proves global budgets cannot silently truncate or return partial files.
func TestGlobalVisitExportLimits(t *testing.T) {
	pool, service, _, admin, link, today := fixture(t)
	input := insights.RangeInput{}
	result, err := service.ExportGlobalVisits(t.Context(), admin, input)
	require.NoError(t, err)
	require.Len(t, exportedCells(t, result), 1)
	_, err = pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),$1,'redirect_response_sent',$2 from generate_series(1,1000)`, link, today)
	require.NoError(t, err)
	result, err = service.ExportGlobalVisits(t.Context(), admin, input)
	require.NoError(t, err)
	require.Len(t, exportedCells(t, result), 1001)
	visit(t, pool, uuid.NewString(), link, today, "", "")
	result, err = service.ExportGlobalVisits(t.Context(), admin, input)
	require.ErrorIs(t, err, insights.ErrVisitExportLimit)
	require.Empty(t, result.Content)
	query := sqlc.New(pool)
	params := sqlc.ExportGlobalInsightVisitsParams{RangeStart: pgtype.Timestamptz{Time: today, Valid: true}, RangeEnd: pgtype.Timestamptz{Time: today.AddDate(0, 0, 1), Valid: true}}
	rows, err := query.ExportGlobalInsightVisits(t.Context(), params)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	require.True(t, rows[0].LimitExceeded)
	require.Empty(t, rows[0].ID)
	require.Empty(t, rows[0].ShortLinkID)
	_, err = pool.Exec(t.Context(), `delete from short_link_event`)
	require.NoError(t, err)
	visit(t, pool, uuid.NewString(), link, today, "", "")
	for _, size := range []int{8388608, 8388609} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('x',$1)`, size)
		require.NoError(t, err)
		rows, err = query.ExportGlobalInsightVisits(t.Context(), params)
		require.NoError(t, err)
		require.Len(t, rows, 1)
		if size == 8388608 {
			require.False(t, rows[0].LimitExceeded)
			require.Len(t, rows[0].ReferrerHost, size)
		} else {
			require.True(t, rows[0].LimitExceeded)
			require.Empty(t, rows[0].ID)
			require.Empty(t, rows[0].ShortLinkID)
			require.Empty(t, rows[0].ReferrerHost)
			require.Empty(t, rows[0].DeviceType)
			require.Empty(t, rows[0].BrowserFamily)
			require.Empty(t, rows[0].OsFamily)
			require.Empty(t, rows[0].CountryCode)
		}
		result, err = service.ExportGlobalVisits(t.Context(), admin, input)
		require.ErrorIs(t, err, insights.ErrVisitExportLimit)
		require.Empty(t, result.Content)
	}
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('"',4194304)`)
	require.NoError(t, err)
	result, err = service.ExportGlobalVisits(t.Context(), admin, input)
	require.ErrorIs(t, err, insights.ErrVisitExportLimit)
	require.Empty(t, result.Content)
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=null`)
	require.NoError(t, err)
	baseline, err := service.ExportGlobalVisits(t.Context(), admin, input)
	require.NoError(t, err)
	for _, extra := range []int{0, 1} {
		_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('x',$1)`, 8388608-len(baseline.Content)+extra)
		require.NoError(t, err)
		result, err = service.ExportGlobalVisits(t.Context(), admin, input)
		if extra == 0 {
			require.NoError(t, err)
			require.Len(t, result.Content, 8388608)
		} else {
			require.ErrorIs(t, err, insights.ErrVisitExportLimit)
			require.Empty(t, result.Content)
		}
	}
	// Multiple dimensions must share one raw-text budget, rather than individual caps.
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=repeat('x',4194304),device_type=repeat('y',4194305)`)
	require.NoError(t, err)
	rows, err = query.ExportGlobalInsightVisits(t.Context(), params)
	require.NoError(t, err)
	require.True(t, rows[0].LimitExceeded)
	require.Empty(t, rows[0].ReferrerHost)
	require.Empty(t, rows[0].DeviceType)
	// Quoted Unicode survives CSV encoding without exposing other event or account fields.
	_, err = pool.Exec(t.Context(), `update short_link_event set referrer_host=$1,device_type=null`, "雪,\"山\"")
	require.NoError(t, err)
	result, err = service.ExportGlobalVisits(t.Context(), admin, input)
	require.NoError(t, err)
	require.Equal(t, "雪,\"山\"", exportedCells(t, result)[1][6])
	require.False(t, strings.Contains(result.Content, "target.example"))
}
