package insights_test

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestMain releases the package's isolated PostgreSQL container after cleanup.
func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }

// fixture creates real current identities, rather than trusting the supplied session group.
func fixture(t *testing.T) (*pgxpool.Pool, *insights.Service, auth.CurrentUser, auth.CurrentUser, string, time.Time) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	for _, group := range []struct {
		key         string
		permissions []string
	}{{"guest", nil}, {"user", permission.UserPermissions}, {"admin", permission.AdminPermissions}} {
		data, err := json.Marshal(group.permissions)
		require.NoError(t, err)
		if group.permissions == nil {
			data = []byte("[]")
		}
		_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),$1,$1,$2,true,now(),now())`, group.key, data)
		require.NoError(t, err)
	}
	users := make([]auth.CurrentUser, 0, 5)
	for _, row := range []struct {
		name, group, status string
		deleted             bool
	}{{"owner", "user", "active", false}, {"admin", "admin", "active", false}, {"disabled", "user", "disabled", false}, {"deleted", "user", "active", true}, {"guest", "guest", "active", false}} {
		id := uuid.NewString()
		_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at,deleted_at) select $1,$2,$2,id,$4,false,now(),now(),case when $5 then now() end from user_group where key=$3`, id, row.name, row.group, row.status, row.deleted)
		require.NoError(t, err)
		users = append(users, auth.CurrentUser{ID: id, Username: row.name, GroupKey: row.group})
	}
	_, err := pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values('00000000-0000-0000-0000-000000000101','short.example','Short','short_link',true,true,now(),now())`)
	require.NoError(t, err)
	link := newLink(t, pool, users[0].ID, "first", false)
	var now time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select now()`).Scan(&now))
	return pool, insights.NewService(pool, permission.NewDatabaseService(pool)), users[0], users[1], link, now.UTC().Truncate(24 * time.Hour)
}

// newLink persists an explicit ownership and deletion fixture without bypassing production constraints.
func newLink(t *testing.T, pool *pgxpool.Pool, owner, slug string, deleted bool) string {
	t.Helper()
	id := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at,deleted_at) values($1,$2,'00000000-0000-0000-0000-000000000101',$3,'https://target.example/private','active',now(),now(),case when $4 then now() end)`, id, owner, slug, deleted)
	require.NoError(t, err)
	return id
}

// visit persists one successful redirect at a controlled UUID and UTC instant.
func visit(t *testing.T, pool *pgxpool.Pool, id, link string, at time.Time, device, country string) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at,device_type,country_code) values($1,$2,'redirect_response_sent',$3,nullif($4,''),nullif($5,''))`, id, link, at, device, country)
	require.NoError(t, err)
}

// TestDashboardSnapshotAndUTCRange catches lifetime scans, UTC boundary leaks, missing zero days and deleted-event loss.
func TestDashboardSnapshotAndUTCRange(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	start := today.AddDate(0, 0, -3)
	visit(t, pool, uuid.NewString(), link, start, "", "")
	visit(t, pool, uuid.NewString(), link, start.Add(-time.Microsecond), "", "")
	visit(t, pool, uuid.NewString(), link, today, "", "")
	for i := 1; i <= 12; i++ {
		id := newLink(t, pool, owner.ID, fmt.Sprintf("rank%d", i), i == 12)
		for n := 0; n < i; n++ {
			visit(t, pool, uuid.NewString(), id, start, "", "")
		}
	}
	_, err := pool.Exec(t.Context(), `update short_link set status='disabled' where id=$1`, link)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) values(gen_random_uuid(),$1,'redirect_blocked',$2)`, link, start)
	require.NoError(t, err)
	result, err := service.Dashboard(t.Context(), admin, insights.RangeInput{StartDate: start.Format(time.DateOnly), EndDate: today.AddDate(0, 0, -1).Format(time.DateOnly)})
	require.NoError(t, err)
	require.Equal(t, int64(3), result.Summary.UserCount)
	require.Equal(t, int64(2), result.Summary.ActiveUserCount)
	require.Equal(t, int64(12), result.Summary.LinkCount)
	require.Equal(t, int64(11), result.Summary.ActiveLinkCount)
	require.Equal(t, int64(12), result.Summary.TodayCreatedLinkCount)
	require.Equal(t, int64(1), result.Summary.TodayVisitCount)
	require.Equal(t, int64(79), result.Summary.RangeVisitCount)
	require.Len(t, result.Trend, 3)
	require.Equal(t, int64(79), result.Trend[0].VisitCount)
	require.Zero(t, result.Trend[1].VisitCount)
	require.Zero(t, result.Trend[2].VisitCount)
	require.Len(t, result.TopLinks, 10)
	require.Equal(t, "rank12", result.TopLinks[0].Slug)
	require.True(t, result.TopLinks[0].Deleted)
	require.Equal(t, int64(12), result.TopLinks[0].VisitCount)
	require.Equal(t, "UTC", result.Range.TimeZone)
	require.False(t, result.GeneratedAt.IsZero())
}

// TestVisitRecordsScopeAndCursor catches IDOR, offset pagination duplicates and missing tie-breakers.
func TestVisitRecordsScopeAndCursor(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	ids := []string{"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", "00000000-0000-0000-0000-000000000003"}
	for _, id := range ids {
		visit(t, pool, id, link, today, "desktop", "CN")
	}
	visit(t, pool, uuid.NewString(), link, today.Add(-time.Microsecond), "", "")
	input := insights.VisitInput{ID: link, PageSize: 2, DeviceType: "desktop", CountryCode: "CN"}
	first, err := service.Visits(t.Context(), owner, input)
	require.NoError(t, err)
	require.Len(t, first.Items, 2)
	require.Equal(t, ids[2], first.Items[0].ID)
	require.Equal(t, ids[1], first.Items[1].ID)
	require.True(t, first.HasMore)
	require.NotEmpty(t, first.NextCursor)
	require.Nil(t, first.Items[0].BrowserFamily)
	visit(t, pool, uuid.NewString(), link, today.Add(time.Second), "desktop", "CN")
	input.Cursor = first.NextCursor
	second, err := service.Visits(t.Context(), owner, input)
	require.NoError(t, err)
	require.Len(t, second.Items, 1)
	require.Equal(t, ids[0], second.Items[0].ID)
	require.False(t, second.HasMore)
	require.Empty(t, second.NextCursor)
	_, err = service.Visits(t.Context(), admin, insights.VisitInput{ID: link})
	require.ErrorIs(t, err, insights.ErrLinkMissing)
	all, err := service.AdminVisits(t.Context(), admin, insights.VisitInput{ID: link})
	require.NoError(t, err)
	require.Len(t, all.Items, 5)
	unknown, err := service.Visits(t.Context(), owner, insights.VisitInput{ID: link, DeviceType: "unknown", CountryCode: "unknown"})
	require.NoError(t, err)
	require.Len(t, unknown.Items, 1)
	require.Nil(t, unknown.Items[0].CountryCode)
	_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, link)
	require.NoError(t, err)
	_, err = service.AdminVisits(t.Context(), admin, insights.VisitInput{ID: link})
	require.ErrorIs(t, err, insights.ErrLinkMissing)
	_, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.ErrorIs(t, err, insights.ErrLinkMissing)
}

// TestInsightAuthorization catches trusting stale session groups or cached permissions.
func TestInsightAuthorization(t *testing.T) {
	pool, service, owner, admin, link, _ := fixture(t)
	for _, identity := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad"}, {ID: uuid.NewString(), GroupKey: "admin"}} {
		_, err := service.Dashboard(t.Context(), identity, insights.RangeInput{})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
	_, err := insights.NewService(pool, nil).Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
	for _, sql := range []string{`update app_user set status='disabled' where username='owner'`, `update app_user set status='active',deleted_at=now() where username='owner'`, `update app_user set deleted_at=null,group_id=(select id from user_group where key='guest') where username='owner'`, `update app_user set group_id=(select id from user_group where key='user') where username='owner'; update user_group set permissions=permissions-'short_link:read_visits' where key='user'`} {
		_, err = pool.Exec(t.Context(), sql)
		require.NoError(t, err)
		_, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
		require.ErrorIs(t, err, insights.ErrPermissionDenied)
	}
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'statistics:read_all' where key='admin'`)
	require.NoError(t, err)
	_, err = service.Dashboard(t.Context(), admin, insights.RangeInput{})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
}

// TestInsightPermissionIntersections rejects loss of any required capability, even with a stale privileged session.
func TestInsightPermissionIntersections(t *testing.T) {
	pool, service, owner, admin, link, _ := fixture(t)
	for _, test := range []struct {
		group, key string
		actor      auth.CurrentUser
		dashboard  bool
	}{
		{"user", "short_link:read_own", owner, false},
		{"admin", "short_link:read_visits", admin, false},
		{"admin", "short_link:read_all", admin, false},
		{"admin", "admin:access", admin, false},
		{"admin", "admin:access", admin, true},
	} {
		t.Run(test.group+test.key+fmt.Sprint(test.dashboard), func(t *testing.T) {
			var original []byte
			require.NoError(t, pool.QueryRow(t.Context(), `select permissions from user_group where key=$1`, test.group).Scan(&original))
			t.Cleanup(func() {
				_, err := pool.Exec(context.Background(), `update user_group set permissions=$1 where key=$2`, original, test.group)
				require.NoError(t, err)
			})
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key=$2`, test.key, test.group)
			require.NoError(t, err)
			if test.dashboard {
				_, err = service.Dashboard(t.Context(), test.actor, insights.RangeInput{})
			} else if test.group == "admin" {
				_, err = service.AdminVisits(t.Context(), test.actor, insights.VisitInput{ID: link})
			} else {
				_, err = service.Visits(t.Context(), test.actor, insights.VisitInput{ID: link})
			}
			require.ErrorIs(t, err, insights.ErrPermissionDenied)
		})
	}
}
