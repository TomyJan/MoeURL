package shortlink_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestSelectedListExportCompleteness catches partial intersections and unauthorized or stale-owner reads.
func TestSelectedListExportCompleteness(t *testing.T) {
	pool, service, admin, owner, other, transfer := transferFixture(t)
	ctx := t.Context()
	own := insertStoredShortLink(t, ctx, pool, owner.ID, "selectedown", "https://example.com/new", "active", false)
	foreign := insertStoredShortLink(t, ctx, pool, other.ID, "selectedforeign", "https://example.com/other", "active", false)
	deleted := insertStoredShortLink(t, ctx, pool, owner.ID, "selecteddeleted", "https://example.com/deleted", "active", true)
	missing := "00000000-0000-0000-0000-00000000e699"
	_, err := pool.Exec(ctx, `update short_link set created_at=case when id=$1 then '2026-11-01'::timestamptz else '2026-11-02'::timestamptz end,title='current server title',note='selected-private-canary' where id in ($1,$2,$3)`, transfer.ID, own, foreign)
	require.NoError(t, err)
	var before string
	var eventsBefore, auditBefore int
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_agg(to_jsonb(s) order by id)::text from short_link s`).Scan(&before))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&eventsBefore))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&auditBefore))
	for _, tc := range []struct {
		name  string
		actor auth.CurrentUser
		admin bool
		ids   []string
		want  []string
	}{
		{"single", owner, false, []string{own}, []string{own}},
		{"server-order", owner, false, []string{transfer.ID, own}, []string{own, transfer.ID}},
		{"foreign-only", owner, false, []string{foreign}, nil},
		{"mixed-foreign", owner, false, []string{own, foreign}, nil},
		{"mixed-missing", owner, false, []string{own, missing}, nil},
		{"mixed-deleted", owner, false, []string{own, deleted}, nil},
		{"admin-foreign", admin, true, []string{transfer.ID, foreign}, []string{foreign, transfer.ID}},
		{"admin-missing", admin, true, []string{own, missing}, nil},
		{"admin-deleted", admin, true, []string{own, deleted}, nil},
		{"own-not-admin", owner, true, []string{own}, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var result shortlink.ListExport
			var err error
			input := shortlink.SelectedListExportInput{IDs: tc.ids}
			if tc.admin {
				result, err = service.AdminExportSelectedList(ctx, tc.actor, input)
			} else {
				result, err = service.ExportSelectedList(ctx, tc.actor, input)
			}
			if tc.want == nil {
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				require.Empty(t, result.Content)
				return
			}
			require.NoError(t, err)
			rows := listExportRows(t, result)
			require.Len(t, rows, len(tc.want)+1)
			for i, id := range tc.want {
				require.Len(t, rows[i+1], 17)
				require.Equal(t, id, rows[i+1][0])
				require.Equal(t, "current server title", rows[i+1][4])
			}
			require.NotContains(t, result.Content, "selected-private-canary")
			require.NotContains(t, result.Content, "private-password-hash")
		})
	}
	var after string
	var eventsAfter, auditAfter int
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_agg(to_jsonb(s) order by id)::text from short_link s`).Scan(&after))
	require.Equal(t, before, after)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&eventsAfter))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&auditAfter))
	require.Equal(t, eventsBefore, eventsAfter)
	require.Equal(t, auditBefore, auditAfter)
	_, err = service.Transfer(ctx, admin, transfer)
	require.NoError(t, err)
	result, err := service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: []string{own, transfer.ID}})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Empty(t, result.Content)
	result, err = service.ExportSelectedList(ctx, other, shortlink.SelectedListExportInput{IDs: []string{transfer.ID}})
	require.NoError(t, err)
	require.Equal(t, transfer.ID, listExportRows(t, result)[1][0])
}

// TestSelectedListExportFinalGrant catches grants revoked after a permissive entry resolver.
func TestSelectedListExportFinalGrant(t *testing.T) {
	pool, _, admin, owner, _, transfer := transferFixture(t)
	stale := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	run := func(t *testing.T, actor auth.CurrentUser, adminScope bool) {
		t.Helper()
		var result shortlink.ListExport
		var err error
		if adminScope {
			result, err = stale.AdminExportSelectedList(t.Context(), actor, shortlink.SelectedListExportInput{IDs: []string{transfer.ID}})
		} else {
			result, err = stale.ExportSelectedList(t.Context(), actor, shortlink.SelectedListExportInput{IDs: []string{transfer.ID}})
		}
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		require.Empty(t, result.Content)
	}
	for _, tc := range []struct {
		actor auth.CurrentUser
		key   string
		admin bool
	}{{owner, permission.ShortLinkExport, false}, {owner, permission.ShortLinkReadOwn, false}, {admin, permission.ShortLinkExport, true}, {admin, permission.ShortLinkReadAll, true}, {admin, permission.AdminAccess, true}} {
		if tc.admin && tc.key != permission.ShortLinkExport {
			// Read-all and admin access are protected; the export grant is revocable.
			continue
		}
		t.Run(tc.actor.GroupKey+"/"+tc.key, func(t *testing.T) {
			var original string
			require.NoError(t, pool.QueryRow(t.Context(), `select permissions::text from user_group where key=$1`, tc.actor.GroupKey).Scan(&original))
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, err := pool.Exec(ctx, `update user_group set permissions=$1::jsonb where key=$2`, original, tc.actor.GroupKey)
				require.NoError(t, err)
			})
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key=$2`, tc.key, tc.actor.GroupKey)
			require.NoError(t, err)
			run(t, tc.actor, tc.admin)
		})
	}
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		(gen_random_uuid(),'guest','Guest',$1::jsonb,true,now(),now()),
		(gen_random_uuid(),'restricted','Restricted','[]',false,now(),now())`, permissionsJSON(t, permission.AdminPermissions))
	require.NoError(t, err)
	for _, actor := range []auth.CurrentUser{owner, admin} {
		for _, change := range []string{`status='disabled'`, `deleted_at=now()`, `group_id=(select id from user_group where key='guest')`, `group_id=(select id from user_group where key='restricted')`} {
			t.Run(actor.GroupKey+"/"+change, func(t *testing.T) {
				var group string
				require.NoError(t, pool.QueryRow(t.Context(), `select group_id::text from app_user where id=$1`, actor.ID).Scan(&group))
				t.Cleanup(func() {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					_, err := pool.Exec(ctx, `update app_user set status='active',deleted_at=null,group_id=$2 where id=$1`, actor.ID, group)
					require.NoError(t, err)
				})
				_, err := pool.Exec(t.Context(), `update app_user set `+change+` where id=$1`, actor.ID)
				require.NoError(t, err)
				run(t, actor, actor.GroupKey == "admin")
			})
		}
	}
	unknown := owner
	unknown.ID = uuid.NewString()
	run(t, unknown, false)
}

// TestSelectedListExportCountAndSQLDefense catches truncation, empty-selection fallback and bypassed Service validation.
func TestSelectedListExportCountAndSQLDefense(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "selected-count", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,$1,'00000000-0000-0000-0000-000000000301',
		'selectedcount'||n,'https://example.com','active','2026-11-01'::timestamptz,now() from generate_series(1,101) n`, owner.ID)
	require.NoError(t, err)
	ids := make([]string, 101)
	queryIDs := make([]pgtype.UUID, 101)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-0000-0000-%012d", i+1)
		queryIDs[i] = pgtype.UUID{Bytes: uuid.MustParse(ids[i]), Valid: true}
	}
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	for _, count := range []int{1, 100} {
		result, err := service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: ids[:count]})
		require.NoError(t, err)
		rows := listExportRows(t, result)
		require.Len(t, rows, count+1)
		for i := 0; i < count; i++ {
			require.Equal(t, ids[count-i-1], rows[i+1][0])
		}
	}
	result, err := service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: ids})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	require.Empty(t, result.Content)
	for _, invalid := range [][]pgtype.UUID{nil, {}, {{}}, {{Bytes: uuid.Nil, Valid: true}}, {queryIDs[0], queryIDs[0]}, queryIDs} {
		rows, err := sqlc.New(pool).ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{PermissionGranted: true, ActorID: pgtype.UUID{Bytes: uuid.MustParse(owner.ID), Valid: true}, SelectionMode: true, SelectedIds: invalid})
		require.NoError(t, err)
		require.Len(t, rows, 1)
		require.True(t, rows[0].Allowed && rows[0].SelectionUnavailable)
		require.True(t, rows[0].ID == "" && rows[0].TargetUrl == "" && rows[0].Title == "" && len(rows[0].Tags) == 0)
	}
	// The false/nil legacy mode still exports every row, independently of selection.
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 102)
}

// TestSelectedListExportReadBudget checks the raw SQL and final CSV caps independently for a complete selection.
func TestSelectedListExportReadBudget(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "read-budget-owner", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		select gen_random_uuid(),$1,'00000000-0000-0000-0000-000000000301','r'||lpad(n::text,2,'0'),
		'https://example.com/'||repeat('a',699000-20),'active',now(),now() from generate_series(1,12) n`, owner.ID)
	require.NoError(t, err)
	var ids []string
	rows, err := pool.Query(ctx, `select id::text from short_link order by id`)
	require.NoError(t, err)
	for rows.Next() {
		var id string
		require.NoError(t, rows.Scan(&id))
		ids = append(ids, id)
	}
	require.NoError(t, rows.Err())
	rows.Close()
	queryIDs := make([]pgtype.UUID, len(ids))
	for i, id := range ids {
		queryIDs[i] = pgtype.UUID{Bytes: uuid.MustParse(id), Valid: true}
	}
	read := func(selected []pgtype.UUID) []sqlc.ExportShortLinkListRow {
		t.Helper()
		result, err := sqlc.New(pool).ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{PermissionGranted: true, ActorID: pgtype.UUID{Bytes: uuid.MustParse(owner.ID), Valid: true}, SelectionMode: true, SelectedIds: selected})
		require.NoError(t, err)
		return result
	}
	// 8,388,000 URL bytes plus 552 other original text bytes leaves exactly 56 bytes.
	_, err = pool.Exec(ctx, `update short_link set title=repeat('x',56) where slug='r01'`)
	require.NoError(t, err)
	resultRows := read(queryIDs)
	require.Len(t, resultRows, 12)
	require.False(t, resultRows[0].LimitExceeded || resultRows[0].SelectionUnavailable)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: ids})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	_, err = pool.Exec(ctx, `update short_link set title=repeat('x',57) where slug='r01'`)
	require.NoError(t, err)
	resultRows = read(queryIDs)
	require.Len(t, resultRows, 1)
	require.True(t, resultRows[0].LimitExceeded && !resultRows[0].SelectionUnavailable)
	require.True(t, resultRows[0].ID == "" && resultRows[0].TargetUrl == "" && resultRows[0].Title == "")
	result, err = service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: ids})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	// A missing member wins over the size category and never emits the accessible intersection.
	missing := "00000000-0000-0000-0000-00000000e699"
	resultRows = read(append(queryIDs, pgtype.UUID{Bytes: uuid.MustParse(missing), Valid: true}))
	require.Len(t, resultRows, 1)
	require.True(t, resultRows[0].LimitExceeded && resultRows[0].SelectionUnavailable && resultRows[0].TargetUrl == "")
	result, err = service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: append(ids, missing)})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Empty(t, result.Content)
	_, err = pool.Exec(ctx, `update short_link set target_url=left(target_url,698000)`)
	require.NoError(t, err)
	result, err = service.ExportSelectedList(ctx, owner, shortlink.SelectedListExportInput{IDs: ids})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 13)
	require.Less(t, len(result.Content), 8*1024*1024)
}
