package shortlink_test

import (
	"encoding/csv"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestListExportReadBudget rejects large text before SQLC can retain the result set.
func TestListExportReadBudget(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "read-budget-owner", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		select gen_random_uuid(),$1,'00000000-0000-0000-0000-000000000301','readbudget'||n,
		'https://example.com/' || repeat('a',900*1024),'active',now(),now() from generate_series(1,12) n`, owner.ID)
	require.NoError(t, err)
	rows, err := sqlc.New(pool).ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{ActorID: pgtype.UUID{Bytes: uuid.MustParse(owner.ID), Valid: true}})
	require.NoError(t, err)
	// Check lengths without dumping a multi-megabyte result on failure.
	require.Equal(t, 1, len(rows), "over-budget reads must return a single empty sentinel")
	require.True(t, rows[0].Allowed)
	require.True(t, rows[0].LimitExceeded)
	require.True(t, rows[0].ID == "" && rows[0].TargetUrl == "" && len(rows[0].Tags) == 0)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{user: owner}, ShortLinkListExport: service})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/short-link/export", nil)
	req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	res := httptest.NewRecorder()
	router.ServeHTTP(res, req)
	require.NotContains(t, res.Body.String(), "content")
	assertBusinessCode(t, res, http.StatusOK, 200118)

	// Twelve legal-size URLs total 8,388,000 bytes. The other original text is
	// (14 host + 3 slug + 17 username + 6 status + 6 mode) * 12 = 552 bytes.
	// Thus exactly 56 bytes remain in the raw budget, independently of CSV overhead.
	_, err = pool.Exec(ctx, `update short_link set target_url='https://example.com/' || repeat('a',699000-20), slug='r'||lpad(substring(slug from 11),2,'0')`)
	require.NoError(t, err)
	read := func(t *testing.T) []sqlc.ExportShortLinkListRow {
		t.Helper()
		rows, err := sqlc.New(pool).ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{ActorID: pgtype.UUID{Bytes: uuid.MustParse(owner.ID), Valid: true}})
		require.NoError(t, err)
		return rows
	}
	rows = read(t)
	require.Equal(t, 12, len(rows))
	require.False(t, rows[0].LimitExceeded)
	_, err = pool.Exec(ctx, `update short_link set title=repeat('x',56) where slug='r01'`)
	require.NoError(t, err)
	rows = read(t)
	require.Equal(t, 12, len(rows))
	require.False(t, rows[0].LimitExceeded)
	// The raw budget admits this set, while the independent exact CSV cap rejects it.
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	for _, test := range []struct{ name, change, restore string }{
		{"one byte over", `update short_link set title=repeat('x',57) where slug='r01'`, `update short_link set title=''`},
		{"title UTF-8", `update short_link set title='界界'`, `update short_link set title=''`},
		{"tag elements UTF-8", `update short_link set tags=array['界界']`, `update short_link set tags='{}'`},
		{"owner username", `update app_user set username='read-budget-owner-more' where id=$1`, `update app_user set username='read-budget-owner' where id=$1`},
		{"original domain", `update domain set host='more.go.example.com'`, `update domain set host='go.example.com'`},
		{"slug", `update short_link set slug='longread'||right(slug,2)`, `update short_link set slug='r'||right(slug,2)`},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := pool.Exec(ctx, `update short_link set title=''`)
			require.NoError(t, err)
			arguments := []any{}
			if test.name == "owner username" {
				arguments = append(arguments, owner.ID)
			}
			_, err = pool.Exec(ctx, test.change, arguments...)
			require.NoError(t, err)
			t.Cleanup(func() { _, err := pool.Exec(ctx, test.restore, arguments...); require.NoError(t, err) })
			rows := read(t)
			require.Equal(t, 1, len(rows))
			require.True(t, rows[0].Allowed && rows[0].LimitExceeded)
			require.True(t, rows[0].ID == "" && rows[0].TargetUrl == "" && rows[0].Title == "" && len(rows[0].Tags) == 0 && rows[0].OwnerUsername == "" && rows[0].DomainHost == "" && rows[0].Slug == "")
		})
	}
	// A nearby, genuinely exportable result must still produce the complete file.
	_, err = pool.Exec(ctx, `update short_link set target_url=left(target_url,698000)`)
	require.NoError(t, err)
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 13)
	require.Less(t, len(result.Content), 8*1024*1024)
}

// listExportRows reads the real file format rather than inspecting serialized source text.
func listExportRows(t *testing.T, result shortlink.ListExport) [][]string {
	t.Helper()
	require.Equal(t, "text/csv;charset=utf-8", result.ContentType)
	require.True(t, strings.HasPrefix(result.Content, "\ufeffid,short_url,"))
	require.True(t, strings.HasSuffix(result.Content, "\r\n"))
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	return rows
}

// TestListExportAdminOwnerSearchParity catches omitted administrator owner filters without broadening personal search.
func TestListExportAdminOwnerSearchParity(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "unique-account-probe", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `update app_user set nickname='独立昵称探针' where id=$1`, owner.ID)
	require.NoError(t, err)
	other := insertShortLinkUserForGroup(t, ctx, pool, "unrelated-person", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "user", permission.UserPermissions)
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'admin','admin',$1::jsonb,true,now(),now())`, permissionsJSON(t, permission.AdminPermissions))
	require.NoError(t, err)
	var adminGroup string
	require.NoError(t, pool.QueryRow(ctx, `select id::text from user_group where key='admin'`).Scan(&adminGroup))
	admin := insertShortLinkUserForGroup(t, ctx, pool, "admin-reader", adminGroup, uuid.NewString(), "admin", permission.AdminPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "neutralone", "https://destination.example/first", "active", false)
	insertStoredShortLink(t, ctx, pool, other.ID, "neutraltwo", "https://destination.example/second", "active", false)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	for _, query := range []string{"UNIQUE-ACCOUNT-PROBE", "独立昵称探针"} {
		t.Run(query, func(t *testing.T) {
			// Neither token appears in a slug, URL, title or tag; only the owner field can match.
			listed, err := service.AdminList(ctx, admin, shortlink.ListInput{Query: query})
			require.NoError(t, err)
			require.Equal(t, int64(1), listed.Total)
			require.Len(t, listed.Items, 1)
			require.Equal(t, linkID, listed.Items[0].ID)
			exported, err := service.AdminExportList(ctx, admin, shortlink.ListExportInput{Query: query})
			require.NoError(t, err)
			rows := listExportRows(t, exported)
			require.Len(t, rows, 2)
			require.Equal(t, linkID, rows[1][0])
			require.Equal(t, listed.Items[0].ID, rows[1][0])
			personal, err := service.List(ctx, owner, shortlink.ListInput{Query: query})
			require.NoError(t, err)
			require.Zero(t, personal.Total)
			require.Empty(t, personal.Items)
			exported, err = service.ExportList(ctx, owner, shortlink.ListExportInput{Query: query})
			require.NoError(t, err)
			require.Len(t, listExportRows(t, exported), 1)
		})
	}
}

// TestListExportAuthorizationAndFilters catches stale session grants, cross-owner reads and filter drift.
func TestListExportAuthorizationAndFilters(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "list-owner", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "list-other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'admin','admin',$1::jsonb,true,now(),now()),(gen_random_uuid(),'guest','guest',$1::jsonb,true,now(),now())`, permissionsJSON(t, permission.AdminPermissions))
	require.NoError(t, err)
	var adminGroup string
	require.NoError(t, pool.QueryRow(ctx, `select id::text from user_group where key='admin'`).Scan(&adminGroup))
	admin := insertShortLinkUserForGroup(t, ctx, pool, "list-admin", adminGroup, uuid.NewString(), "admin", permission.AdminPermissions)
	a := insertStoredShortLink(t, ctx, pool, owner.ID, "exporta", "https://target.example/a", "active", false)
	b := insertStoredShortLink(t, ctx, pool, owner.ID, "exportb", "https://target.example/b", "disabled", false)
	c := insertStoredShortLink(t, ctx, pool, other.ID, "exportc", "https://target.example/c", "active", false)
	insertStoredShortLink(t, ctx, pool, owner.ID, "exportdeleted", "https://target.example/deleted", "active", true)
	_, err = pool.Exec(ctx, `update short_link set created_at=case when id=$1 then '2026-10-01T00:00:00Z'::timestamptz else '2026-10-02T00:00:00Z'::timestamptz end, title=case when id=$1 then 'literal 100%_match' else 'second' end, tags=case when id=$1 then array['Case','find-me'] else array['Case'] end where id in ($1,$2)`, a, b)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Equal(t, "moeurl-links-own.csv", result.FileName)
	rows := listExportRows(t, result)
	require.Len(t, rows, 3)
	require.Equal(t, b, rows[1][0])
	require.Equal(t, a, rows[2][0])
	require.Equal(t, owner.ID, rows[1][15])
	require.Equal(t, "list-owner", rows[1][16])
	var initialVersion string
	var initialEvents, initialAudit int
	require.NoError(t, pool.QueryRow(ctx, `select updated_at::text from short_link where id=$1`, b).Scan(&initialVersion))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&initialEvents))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&initialAudit))
	for _, input := range []shortlink.ListExportInput{{Status: "active"}, {Query: " 100%_match "}, {Query: "find-me"}, {Tag: " find-me "}, {Query: "EXPORTA"}, {Query: "target.example/a"}} {
		result, err := service.ExportList(ctx, owner, input)
		require.NoError(t, err)
		rows := listExportRows(t, result)
		require.Len(t, rows, 2)
		require.Equal(t, a, rows[1][0])
	}
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{Tag: "case"})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 1)
	result, err = service.AdminExportList(ctx, admin, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Equal(t, "moeurl-links-all.csv", result.FileName)
	require.Len(t, listExportRows(t, result), 4)
	var version string
	var events, audit int
	require.NoError(t, pool.QueryRow(ctx, `select updated_at::text from short_link where id=$1`, b).Scan(&version))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&events))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&audit))
	require.Equal(t, initialVersion, version)
	require.Equal(t, initialEvents, events)
	require.Equal(t, initialAudit, audit)
	// A changed default cannot rewrite the original public URL.
	_, err = pool.Exec(ctx, `update domain set is_default=false; insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values(gen_random_uuid(),'new.example','new','short_link',true,true,now(),now())`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `update short_link set owner_id=$2 where id=$1`, a, other.ID)
	require.NoError(t, err)
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	rows = listExportRows(t, result)
	require.Len(t, rows, 2)
	require.Equal(t, "https://go.example.com/exportb", rows[1][1])
	result, err = service.ExportList(ctx, other, shortlink.ListExportInput{Query: "exporta"})
	require.NoError(t, err)
	require.Equal(t, a, listExportRows(t, result)[1][0])
	// Deterministic tie sorting uses id, and exports never alter data or audit rows.
	_, err = pool.Exec(ctx, `update short_link set created_at='2026-10-03Z' where id in ($1,$2)`, a, c)
	require.NoError(t, err)
	result, err = service.ExportList(ctx, other, shortlink.ListExportInput{})
	require.NoError(t, err)
	rows = listExportRows(t, result)
	require.Greater(t, rows[1][0], rows[2][0])
	// Revoke in the database after a permissive entry resolver. The SELECT must reject it itself.
	stale := shortlink.NewService(pool, permission.NewService())
	for _, test := range []struct {
		actor auth.CurrentUser
		key   string
		admin bool
	}{{owner, permission.ShortLinkExport, false}, {owner, permission.ShortLinkReadOwn, false}, {admin, permission.ShortLinkExport, true}, {admin, permission.ShortLinkReadAll, true}, {admin, permission.AdminAccess, true}} {
		_, err = pool.Exec(ctx, `update user_group set permissions=permissions-$1 where key=$2`, test.key, test.actor.GroupKey)
		require.NoError(t, err)
		if test.admin {
			_, err = stale.AdminExportList(ctx, test.actor, shortlink.ListExportInput{})
		} else {
			_, err = stale.ExportList(ctx, test.actor, shortlink.ListExportInput{})
		}
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = pool.Exec(ctx, `update user_group set permissions=permissions || jsonb_build_array($1::text) where key=$2`, test.key, test.actor.GroupKey)
		require.NoError(t, err)
	}
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'restricted','restricted','[]',false,now(),now())`)
	require.NoError(t, err)
	for _, change := range []string{`status='disabled'`, `deleted_at=now()`, `group_id=(select id from user_group where key='guest')`, `group_id=(select id from user_group where key='restricted')`} {
		_, err = pool.Exec(ctx, `update app_user set `+change+` where id=$1`, owner.ID)
		require.NoError(t, err)
		_, err = stale.ExportList(ctx, owner, shortlink.ListExportInput{})
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = pool.Exec(ctx, `update app_user set status='active',deleted_at=null,group_id='00000000-0000-0000-0000-000000000401' where id=$1`, owner.ID)
		require.NoError(t, err)
	}
	unknown := owner
	unknown.ID = uuid.NewString()
	_, err = stale.ExportList(ctx, unknown, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = service.AdminExportList(ctx, owner, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	// No query against redirect events is required to export a management list.
	_, err = pool.Exec(ctx, `drop table short_link_event`)
	require.NoError(t, err)
	_, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
}

// TestListExportLimits proves the database reader never silently truncates an oversized result.
func TestListExportLimits(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "limit-owner", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 1)
	_, err = pool.Exec(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) select gen_random_uuid(),$1,'00000000-0000-0000-0000-000000000301','bulk'||n,'https://example.com','active',now(),now() from generate_series(1,1000) n`, owner.ID)
	require.NoError(t, err)
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.NoError(t, err)
	require.Len(t, listExportRows(t, result), 1001)
	insertStoredShortLink(t, ctx, pool, owner.ID, "overlimit", "https://example.com", "active", false)
	limited, err := sqlc.New(pool).ExportShortLinkList(ctx, sqlc.ExportShortLinkListParams{ActorID: pgtype.UUID{Bytes: uuid.MustParse(owner.ID), Valid: true}})
	require.NoError(t, err)
	require.Equal(t, 1, len(limited))
	require.True(t, limited[0].Allowed && limited[0].LimitExceeded && limited[0].ID == "" && limited[0].TargetUrl == "")
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	// Under the row cap, text growth can still exceed the exact byte budget.
	_, err = pool.Exec(ctx, `delete from short_link where slug='overlimit'; update short_link set target_url='https://example.com/' || repeat('界',3000)`)
	require.NoError(t, err)
	result, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.ErrorIs(t, err, shortlink.ErrListExportLimit)
	require.Empty(t, result.Content)
	_, err = pool.Exec(ctx, `drop table short_link cascade`)
	require.NoError(t, err)
	_, err = service.ExportList(ctx, owner, shortlink.ListExportInput{})
	require.Error(t, err)
	require.NotErrorIs(t, err, shortlink.ErrListExportLimit)
}
