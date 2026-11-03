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
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestNoteSearchSnapshotAndLiteralFilters catches divergent predicates and private text in metadata or CSV.
func TestNoteSearchSnapshotAndLiteralFilters(t *testing.T) {
	pool, service, admin, owner, recipient, transfer := transferFixture(t)
	ctx := t.Context()
	blank := insertStoredShortLink(t, ctx, pool, owner.ID, "searchblank", "https://example.com", "active", false)
	unicodeID := insertStoredShortLink(t, ctx, pool, owner.ID, "searchunicode", "https://example.com", "active", false)
	other := insertStoredShortLink(t, ctx, pool, recipient.ID, "searchother", "https://example.com", "active", false)
	deleted := insertStoredShortLink(t, ctx, pool, owner.ID, "searchdeleted", "https://example.com", "active", true)
	for _, row := range []struct{ id, note, title string }{
		{transfer.ID, "secret%_\\canary", "Alpha"}, {blank, "", "Alpha"},
		{unicodeID, "中文🌲 SECRET%_\\canary", "Beta"}, {other, "secret%_\\canary", "Alpha"}, {deleted, "secret%_\\canary", "Alpha"},
	} {
		_, err := pool.Exec(ctx, "update short_link set note=$2,title=$3,tags=array['Focus'] where id=$1", row.id, row.note, row.title)
		require.NoError(t, err)
	}
	for _, tc := range []struct {
		name, word, status, q, tag, noteStatus string
		own, all                               []string
	}{
		{"literal", "%_\\", "", "", "", "", []string{transfer.ID, unicodeID}, []string{transfer.ID, unicodeID, other}},
		{"case", "SeCrEt", "", "", "", "present", []string{transfer.ID, unicodeID}, []string{transfer.ID, unicodeID, other}},
		{"unicode", "中文🌲", "", "", "", "", []string{unicodeID}, []string{unicodeID}},
		{"intersection", "secret", "disabled", "Alpha", "Focus", "present", []string{transfer.ID}, []string{transfer.ID}},
		{"empty", "", "", "", "", "absent", []string{blank}, []string{blank}},
		{"impossible", "secret", "", "", "", "absent", []string{}, []string{}},
		{"legacy-q", "secret", "", "secret%_\\canary", "", "", []string{}, []string{}},
		{"tag-case", "secret", "", "", "focus", "", []string{}, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 20, Status: tc.status, Query: tc.q, Tag: tc.tag, NoteStatus: tc.noteStatus}, NoteQuery: tc.word}
			ownResult, err := service.SearchOwnNotes(ctx, owner, input)
			require.NoError(t, err)
			ids := []string{}
			for _, item := range ownResult.Items {
				ids = append(ids, item.ID)
			}
			require.ElementsMatch(t, tc.own, ids)
			require.Equal(t, int64(len(tc.own)), ownResult.Total)
			allResult, err := service.SearchAdminNotes(ctx, admin, input)
			require.NoError(t, err)
			ids = []string{}
			for _, item := range allResult.Items {
				ids = append(ids, item.ID)
			}
			require.ElementsMatch(t, tc.all, ids)
			require.Equal(t, int64(len(tc.all)), allResult.Total)
			for _, adminScope := range []bool{false, true} {
				var result shortlink.ListExport
				want := tc.own
				if adminScope {
					result, err = service.ExportAdminNoteSearch(ctx, admin, input)
					want = tc.all
				} else {
					result, err = service.ExportOwnNoteSearch(ctx, owner, input)
				}
				require.NoError(t, err)
				records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
				require.NoError(t, err)
				require.Len(t, records[0], 17)
				ids = []string{}
				for _, row := range records[1:] {
					require.Len(t, row, 17)
					ids = append(ids, row[0])
				}
				require.ElementsMatch(t, want, ids)
				require.NotContains(t, result.Content, "canary")
			}
		})
	}
	input := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 1}, NoteQuery: "secret"}
	first, err := service.SearchOwnNotes(ctx, owner, input)
	require.NoError(t, err)
	input.Page = 2
	second, err := service.SearchOwnNotes(ctx, owner, input)
	require.NoError(t, err)
	if len(first.Items) == 1 && len(second.Items) == 1 {
		require.NotEqual(t, first.Items[0].ID, second.Items[0].ID)
	} else {
		t.Fatalf("missing paged rows: %v / %v", first, second)
	}
	_, err = service.Transfer(ctx, admin, transfer)
	require.NoError(t, err)
	input.Page = 1
	input.Query = "Alpha"
	old, err := service.SearchOwnNotes(ctx, owner, input)
	require.NoError(t, err)
	require.Zero(t, old.Total)
	next, err := service.SearchOwnNotes(ctx, recipient, input)
	require.NoError(t, err)
	require.Equal(t, int64(2), next.Total)
}

// TestNoteSearchCurrentAuthorization catches empty-word and stale entrance-grant bypasses.
func TestNoteSearchCurrentAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, word := range []string{"", "secret"} {
			for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
				t.Run(map[bool]string{false: "own", true: "admin"}[adminScope]+"/"+word+"/"+change, func(t *testing.T) {
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
					input := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 20}, NoteQuery: word}
					if adminScope {
						result, err := service.SearchAdminNotes(t.Context(), actor, input)
						require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
						require.Zero(t, result)
					} else {
						result, err := service.SearchOwnNotes(t.Context(), actor, input)
						require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
						require.Zero(t, result)
					}
				})
			}
		}
	}
}

// TestNoteSearchReadOnly proves querying needs no write capability and export still needs its own grant.
func TestNoteSearchReadOnly(t *testing.T) {
	pool, service, admin, owner, _, link := transferFixture(t)
	_, err := pool.Exec(t.Context(), "update short_link set note='secret' where id=$1", link.ID)
	require.NoError(t, err)
	for _, scope := range []struct {
		actor  auth.CurrentUser
		grants []string
		admin  bool
	}{
		{owner, []string{permission.ShortLinkReadOwn}, false}, {admin, []string{permission.AdminAccess, permission.ShortLinkReadAll}, true},
	} {
		raw, err := json.Marshal(scope.grants)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), "update user_group set permissions=$2::jsonb where id=(select group_id from app_user where id=$1)", scope.actor.ID, raw)
		require.NoError(t, err)
		input := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 20}, NoteQuery: "secret"}
		if scope.admin {
			result, err := service.SearchAdminNotes(t.Context(), scope.actor, input)
			require.NoError(t, err)
			require.Equal(t, int64(1), result.Total)
			_, err = service.ExportAdminNoteSearch(t.Context(), scope.actor, input)
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		} else {
			result, err := service.SearchOwnNotes(t.Context(), scope.actor, input)
			require.NoError(t, err)
			require.Equal(t, int64(1), result.Total)
			_, err = service.ExportOwnNoteSearch(t.Context(), scope.actor, input)
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		}
	}
}

// TestNoteSearchSnapshot proves count and data share a snapshot even without a note-presence filter.
func TestNoteSearchSnapshot(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		t.Run(map[bool]string{false: "own", true: "admin"}[adminScope], func(t *testing.T) {
			pool, _, admin, owner, _, link := transferFixture(t)
			_, err := pool.Exec(t.Context(), "update short_link set note='match' where id=$1", link.ID)
			require.NoError(t, err)
			tracer := &noteStatusCountTracer{after: func() {
				_, err := pool.Exec(t.Context(), "update short_link set note='' where id=$1", link.ID)
				require.NoError(t, err)
			}}
			config := pool.Config()
			config.ConnConfig.Tracer = tracer
			filterPool, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(filterPool.Close)
			service := shortlink.NewService(filterPool, permission.NewService())
			input := shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 20}, NoteQuery: "match"}
			if adminScope {
				result, err := service.SearchAdminNotes(t.Context(), admin, input)
				require.NoError(t, err)
				require.Equal(t, int64(1), result.Total)
				require.Len(t, result.Items, 1)
				next, err := service.SearchAdminNotes(t.Context(), admin, input)
				require.NoError(t, err)
				require.Zero(t, next.Total)
			} else {
				result, err := service.SearchOwnNotes(t.Context(), owner, input)
				require.NoError(t, err)
				require.Equal(t, int64(1), result.Total)
				require.Len(t, result.Items, 1)
				next, err := service.SearchOwnNotes(t.Context(), owner, input)
				require.NoError(t, err)
				require.Zero(t, next.Total)
			}
			require.Nil(t, tracer.after)
		})
	}
}

// TestNoteSearchExportLimits catches applying search after row budgets or exposing unbounded text.
func TestNoteSearchExportLimits(t *testing.T) {
	pool, service, admin, owner, _, _ := transferFixture(t)
	_, err := pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,note,created_at,updated_at)
		select gen_random_uuid(),$1,d.id,'searchlimit'||n,'https://example.com','active',case when n=1 then 'unique' else 'many' end,now(),now()
		from domain d cross join generate_series(1,1002) g(n) where d.is_default`, owner.ID)
	require.NoError(t, err)
	for _, adminScope := range []bool{false, true} {
		for _, word := range []string{"unique", "many"} {
			input := shortlink.NoteSearchInput{NoteQuery: word}
			var result shortlink.ListExport
			if adminScope {
				result, err = service.ExportAdminNoteSearch(t.Context(), admin, input)
			} else {
				result, err = service.ExportOwnNoteSearch(t.Context(), owner, input)
			}
			if word == "many" {
				require.ErrorIs(t, err, shortlink.ErrListExportLimit)
				require.Zero(t, result)
			} else {
				require.NoError(t, err)
				records, e := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Content, "\ufeff"))).ReadAll()
				require.NoError(t, e)
				require.Len(t, records, 2)
				require.Equal(t, "searchlimit1", records[1][2])
			}
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = service.SearchOwnNotes(ctx, owner, shortlink.NoteSearchInput{ListInput: shortlink.ListInput{Page: 1, PageSize: 20}})
	require.Error(t, err)
}
