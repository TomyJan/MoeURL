package shortlink_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestNoteStatusFilters catches inconsistent intersections, count-before-page mistakes and stale ownership.
func TestNoteStatusFilters(t *testing.T) {
	pool, service, admin, owner, recipient, transfer := transferFixture(t)
	ctx := t.Context()
	blank := insertStoredShortLink(t, ctx, pool, owner.ID, "emptyfilter", "https://example.com", "active", false)
	bom := insertStoredShortLink(t, ctx, pool, owner.ID, "bomfilter", "https://example.com", "active", false)
	other := insertStoredShortLink(t, ctx, pool, recipient.ID, "otherfilter", "https://example.com", "active", false)
	deleted := insertStoredShortLink(t, ctx, pool, owner.ID, "deletedfilter", "https://example.com", "active", true)
	for _, row := range []struct{ id, note, title, tag string }{
		{transfer.ID, "secret-note-only-canary", "Alpha", "Focus"},
		{blank, "", "Alpha", "Focus"}, {bom, "\ufeff", "Beta", "Focus"},
		{other, "another private note", "Alpha", "Focus"}, {deleted, "hidden", "Alpha", "Focus"},
	} {
		_, err := pool.Exec(ctx, "update short_link set note=$2,title=$3,tags=array[$4::text] where id=$1", row.id, row.note, row.title, row.tag)
		require.NoError(t, err)
	}
	for _, tc := range []struct {
		name string
		in   shortlink.ListInput
		want []string
		all  []string
	}{
		{"default", shortlink.ListInput{}, []string{transfer.ID, blank, bom}, []string{transfer.ID, blank, bom, other}},
		{"present", shortlink.ListInput{NoteStatus: "present"}, []string{transfer.ID, bom}, []string{transfer.ID, bom, other}},
		{"absent", shortlink.ListInput{NoteStatus: "absent"}, []string{blank}, []string{blank}},
		{"intersection", shortlink.ListInput{NoteStatus: "present", Status: "disabled", Query: "Alpha", Tag: "Focus"}, []string{transfer.ID}, []string{transfer.ID}},
		{"case-sensitive-tag", shortlink.ListInput{NoteStatus: "present", Tag: "focus"}, []string{}, []string{}},
		{"no-note-search", shortlink.ListInput{NoteStatus: "present", Query: "secret-note-only-canary"}, []string{}, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := service.List(ctx, owner, tc.in)
			require.NoError(t, err)
			ids := []string{}
			for _, item := range got.Items {
				ids = append(ids, item.ID)
			}
			require.ElementsMatch(t, tc.want, ids)
			require.Equal(t, int64(len(tc.want)), got.Total)
			all, err := service.AdminList(ctx, admin, tc.in)
			require.NoError(t, err)
			ids = []string{}
			for _, item := range all.Items {
				ids = append(ids, item.ID)
			}
			require.ElementsMatch(t, tc.all, ids)
			require.Equal(t, int64(len(tc.all)), all.Total)
			in := shortlink.ListExportInput{NoteStatus: tc.in.NoteStatus, Status: tc.in.Status, Query: tc.in.Query, Tag: tc.in.Tag}
			for _, isAdmin := range []bool{false, true} {
				var exported shortlink.ListExport
				want := tc.want
				if isAdmin {
					exported, err = service.AdminExportList(ctx, admin, in)
					want = tc.all
				} else {
					exported, err = service.ExportList(ctx, owner, in)
				}
				require.NoError(t, err)
				records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(exported.Content, "\ufeff"))).ReadAll()
				require.NoError(t, err)
				require.Len(t, records[0], 17)
				ids = []string{}
				for _, row := range records[1:] {
					require.Len(t, row, 17)
					ids = append(ids, row[0])
				}
				require.ElementsMatch(t, want, ids)
				require.NotContains(t, exported.Content, "secret-note-only-canary")
			}
		})
	}
	first, err := service.List(ctx, owner, shortlink.ListInput{NoteStatus: "present", Page: 1, PageSize: 1})
	require.NoError(t, err)
	second, err := service.List(ctx, owner, shortlink.ListInput{NoteStatus: "present", Page: 2, PageSize: 1})
	require.NoError(t, err)
	require.Equal(t, int64(2), first.Total)
	require.Equal(t, first.Total, second.Total)
	require.Len(t, first.Items, 1)
	require.Len(t, second.Items, 1)
	require.NotEqual(t, first.Items[0].ID, second.Items[0].ID)
	_, err = service.Transfer(ctx, admin, transfer)
	require.NoError(t, err)
	old, err := service.List(ctx, owner, shortlink.ListInput{NoteStatus: "present", Query: "Alpha"})
	require.NoError(t, err)
	require.Empty(t, old.Items)
	require.Zero(t, old.Total)
	next, err := service.List(ctx, recipient, shortlink.ListInput{NoteStatus: "present", Query: "Alpha"})
	require.NoError(t, err)
	require.Len(t, next.Items, 2)
}

// TestNoteStatusReadOnly catches adding write capabilities to a read-only organizing action.
func TestNoteStatusReadOnly(t *testing.T) {
	pool, service, admin, owner, _, input := transferFixture(t)
	for _, tc := range []struct {
		actor  auth.CurrentUser
		grants []string
		admin  bool
	}{
		{owner, []string{permission.ShortLinkReadOwn, permission.ShortLinkExport}, false},
		{admin, []string{permission.AdminAccess, permission.ShortLinkReadAll, permission.ShortLinkExport}, true},
	} {
		raw, err := json.Marshal(tc.grants)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), "update user_group set permissions=$2::jsonb where id=(select group_id from app_user where id=$1)", tc.actor.ID, raw)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), "update short_link set note='private' where id=$1", input.ID)
		require.NoError(t, err)
		if tc.admin {
			result, err := service.AdminList(t.Context(), tc.actor, shortlink.ListInput{NoteStatus: "present"})
			require.NoError(t, err)
			require.Len(t, result.Items, 1)
			_, err = service.AdminExportList(t.Context(), tc.actor, shortlink.ListExportInput{NoteStatus: "present"})
			require.NoError(t, err)
		} else {
			result, err := service.List(t.Context(), tc.actor, shortlink.ListInput{NoteStatus: "present"})
			require.NoError(t, err)
			require.Len(t, result.Items, 1)
			_, err = service.ExportList(t.Context(), tc.actor, shortlink.ListExportInput{NoteStatus: "present"})
			require.NoError(t, err)
		}
	}
}

// TestNoteStatusCurrentAuthorization catches entrance grants being reused after a real database change.
func TestNoteStatusCurrentAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
			t.Run(map[bool]string{false: "own", true: "admin"}[adminScope]+"/"+change, func(t *testing.T) {
				pool, _, admin, owner, _, _ := transferFixture(t)
				actor := owner
				if adminScope {
					actor = admin
				}
				resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
					var err error
					switch change {
					case "disabled":
						_, err = pool.Exec(t.Context(), "update app_user set status='disabled' where id=$1", actor.ID)
					case "deleted":
						_, err = pool.Exec(t.Context(), "update app_user set deleted_at=now() where id=$1", actor.ID)
					case "guest":
						_, err = pool.Exec(t.Context(), "update user_group set key='guest' where id=(select group_id from app_user where id=$1)", actor.ID)
					case "revoked":
						_, err = pool.Exec(t.Context(), "update user_group set permissions='[]' where id=(select group_id from app_user where id=$1)", actor.ID)
					case "moved":
						id := uuid.NewString()
						_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'no-read','Restricted','[]',false,now(),now())`, id)
						require.NoError(t, err)
						_, err = pool.Exec(t.Context(), "update app_user set group_id=$2 where id=$1", actor.ID, id)
					}
					require.NoError(t, err)
				}}
				service := shortlink.NewService(pool, resolver)
				if adminScope {
					result, err := service.AdminList(t.Context(), actor, shortlink.ListInput{NoteStatus: "present"})
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
					require.Zero(t, result)
				} else {
					result, err := service.List(t.Context(), actor, shortlink.ListInput{NoteStatus: "absent"})
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
					require.Zero(t, result)
				}
			})
		}
	}
}

// TestNoteStatusStorageFailures catches cancelled or broken storage masquerading as an empty filtered list.
func TestNoteStatusStorageFailures(t *testing.T) {
	for _, failure := range []string{"cancelled", "actor storage", "group storage"} {
		t.Run(failure, func(t *testing.T) {
			pool, _, admin, owner, _, _ := transferFixture(t)
			service := shortlink.NewService(pool, permission.NewService())
			ctx := t.Context()
			if failure == "cancelled" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				cancel()
			} else {
				statement := "alter table app_user rename to inaccessible_actor"
				if failure == "group storage" {
					statement = "alter table user_group rename column permissions to inaccessible_grants"
				}
				_, err := pool.Exec(ctx, statement)
				require.NoError(t, err)
			}
			own, err := service.List(ctx, owner, shortlink.ListInput{NoteStatus: "present"})
			require.Error(t, err)
			require.Zero(t, own)
			all, err := service.AdminList(ctx, admin, shortlink.ListInput{NoteStatus: "absent"})
			require.Error(t, err)
			require.Zero(t, all)
			var idle int
			require.NoError(t, pool.QueryRow(t.Context(), "select count(*) from pg_stat_activity where datname=current_database() and state='idle in transaction'").Scan(&idle))
			require.Zero(t, idle, "failed reads must release their snapshot transaction")
		})
	}
}

// noteStatusCountTracer makes a real concurrent write after COUNT, without sleeps or product hooks.
type noteStatusCountTracer struct {
	after func()
	sql   string
}

func (r *noteStatusCountTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	r.sql = data.SQL
	return ctx
}
func (r *noteStatusCountTracer) TraceQueryEnd(_ context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	if r.after != nil && (strings.HasPrefix(r.sql, "-- name: CountShortLinksByOwner") || strings.HasPrefix(r.sql, "-- name: CountAllShortLinks")) {
		f := r.after
		r.after = nil
		f()
	}
}

// TestNoteStatusSnapshot catches count and page belonging to different note-state snapshots.
func TestNoteStatusSnapshot(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		t.Run(map[bool]string{false: "own", true: "admin"}[adminScope], func(t *testing.T) {
			pool, _, admin, owner, _, input := transferFixture(t)
			_, err := pool.Exec(t.Context(), "update short_link set note='present' where id=$1", input.ID)
			require.NoError(t, err)
			tracer := &noteStatusCountTracer{after: func() {
				_, err := pool.Exec(t.Context(), "update short_link set note='' where id=$1", input.ID)
				require.NoError(t, err)
			}}
			config := pool.Config()
			config.ConnConfig.Tracer = tracer
			filterPool, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(filterPool.Close)
			service := shortlink.NewService(filterPool, permission.NewService())
			if adminScope {
				result, err := service.AdminList(t.Context(), admin, shortlink.ListInput{NoteStatus: "present"})
				require.NoError(t, err)
				require.Equal(t, int64(1), result.Total)
				require.Len(t, result.Items, 1)
				next, err := service.AdminList(t.Context(), admin, shortlink.ListInput{NoteStatus: "present"})
				require.NoError(t, err)
				require.Zero(t, next.Total)
				require.Empty(t, next.Items)
			} else {
				result, err := service.List(t.Context(), owner, shortlink.ListInput{NoteStatus: "present"})
				require.NoError(t, err)
				require.Equal(t, int64(1), result.Total)
				require.Len(t, result.Items, 1)
				next, err := service.List(t.Context(), owner, shortlink.ListInput{NoteStatus: "present"})
				require.NoError(t, err)
				require.Zero(t, next.Total)
				require.Empty(t, next.Items)
			}
			require.Nil(t, tracer.after, "the concurrent write must actually occur")
		})
	}
}
