package shortlink_test

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestTagCatalogScopeAndCounts catches cross-owner leaks, double-counted array elements and filtering out managed states.
func TestTagCatalogScopeAndCounts(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "tag-owner", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "tag-other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "user", permission.UserPermissions)
	a := insertStoredShortLink(t, ctx, pool, owner.ID, "taga", "https://example.com/a", "active", false)
	b := insertStoredShortLink(t, ctx, pool, owner.ID, "tagb", "https://example.com/b", "disabled", false)
	c := insertStoredShortLink(t, ctx, pool, owner.ID, "tagc", "https://example.com/c", "active", false)
	d := insertStoredShortLink(t, ctx, pool, owner.ID, "tagdeleted", "https://example.com/deleted", "active", true)
	e := insertStoredShortLink(t, ctx, pool, other.ID, "tagother", "https://example.com/other", "active", false)
	for _, fixture := range []struct {
		id   string
		tags []string
	}{
		{a, []string{"Shared", "Case", "dup", "dup"}},
		{b, []string{"Shared", "case"}},
		{c, []string{"Shared", "中文"}},
		{d, []string{"Shared", "deleted-only"}},
		{e, []string{"Shared", "private-other"}},
	} {
		_, err := pool.Exec(ctx, `update short_link set tags=$2 where id=$1`, fixture.id, fixture.tags)
		require.NoError(t, err)
	}
	_, err := pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values('00000000-0000-0000-0000-000000000302','disabled.example.com','Disabled','short_link',false,false,now(),now());
		update short_link set domain_id='00000000-0000-0000-0000-000000000302',expires_at=now()-interval '1 day',max_visits=1,visits_used=1 where slug='tagc'`)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Equal(t, shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{
		{Tag: "Shared", LinkCount: 3}, {Tag: "Case", LinkCount: 1}, {Tag: "case", LinkCount: 1}, {Tag: "dup", LinkCount: 1}, {Tag: "中文", LinkCount: 1},
	}}, result)
	result, err = service.ListTags(ctx, other, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Equal(t, []shortlink.TagCatalogItem{{Tag: "Shared", LinkCount: 1}, {Tag: "private-other", LinkCount: 1}}, result.Items)
	// A transferred link disappears from the old owner's next read without moving or renaming its tags.
	_, err = pool.Exec(ctx, `update short_link set owner_id=$2 where id=$1`, a, other.ID)
	require.NoError(t, err)
	result, err = service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Equal(t, []shortlink.TagCatalogItem{{Tag: "Shared", LinkCount: 2}, {Tag: "case", LinkCount: 1}, {Tag: "中文", LinkCount: 1}}, result.Items)
	_, err = pool.Exec(ctx, `update short_link set deleted_at=now() where owner_id=$1`, owner.ID)
	require.NoError(t, err)
	result, err = service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Equal(t, shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{}}, result)
}

// TestTagCatalogLiteralSearchAndLimit catches wildcard interpretation, inconsistent ordering and silent catalog truncation.
func TestTagCatalogLiteralSearchAndLimit(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "search-owner", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,tags,created_at,updated_at)
		select gen_random_uuid(),$1,'00000000-0000-0000-0000-000000000301','catalog'||n,'https://example.com/'||n,'active',array['tag'||lpad(n::text,2,'0')],now(),now() from generate_series(1,51) n`, owner.ID)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	result, err := service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Len(t, result.Items, 50)
	require.True(t, result.HasMore)
	for i, item := range result.Items {
		require.Equal(t, shortlink.TagCatalogItem{Tag: fmt.Sprintf("tag%02d", i+1), LinkCount: 1}, item)
	}
	result, err = service.ListTags(ctx, owner, shortlink.TagCatalogInput{Query: "51"})
	require.NoError(t, err)
	require.Equal(t, shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{{Tag: "tag51", LinkCount: 1}}}, result)
	_, err = pool.Exec(ctx, `update short_link set deleted_at=now() where slug='catalog51'`)
	require.NoError(t, err)
	result, err = service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.NoError(t, err)
	require.Len(t, result.Items, 50)
	require.False(t, result.HasMore)
	id := insertStoredShortLink(t, ctx, pool, owner.ID, "literalchars", "https://example.com/literal", "active", false)
	_, err = pool.Exec(ctx, `update short_link set tags=$2 where id=$1`, id, []string{"100%_\\Case", strings.Repeat("界", 32), "Café", "Cafe\u0301", "<b>literal</b>"})
	require.NoError(t, err)
	for _, tc := range []struct {
		query string
		want  []shortlink.TagCatalogItem
	}{
		{"%", []shortlink.TagCatalogItem{{Tag: "100%_\\Case", LinkCount: 1}}},
		{"_", []shortlink.TagCatalogItem{{Tag: "100%_\\Case", LinkCount: 1}}},
		{"\\", []shortlink.TagCatalogItem{{Tag: "100%_\\Case", LinkCount: 1}}},
		{"Case", []shortlink.TagCatalogItem{{Tag: "100%_\\Case", LinkCount: 1}}},
		{"case", []shortlink.TagCatalogItem{}},
		{"\u3000Café\u00a0", []shortlink.TagCatalogItem{{Tag: "Café", LinkCount: 1}}},
		{"Cafe\u0301", []shortlink.TagCatalogItem{{Tag: "Cafe\u0301", LinkCount: 1}}},
		{strings.Repeat("界", 32), []shortlink.TagCatalogItem{{Tag: strings.Repeat("界", 32), LinkCount: 1}}},
		{"<b>", []shortlink.TagCatalogItem{{Tag: "<b>literal</b>", LinkCount: 1}}},
	} {
		t.Run(tc.query, func(t *testing.T) {
			result, err := service.ListTags(ctx, owner, shortlink.TagCatalogInput{Query: tc.query})
			require.NoError(t, err)
			require.Equal(t, shortlink.TagCatalogResult{Items: tc.want}, result)
		})
	}
	for _, query := range []string{strings.Repeat("界", 33), "\tCase", "Case\n", "\x00", "\x7f", string([]byte{0xff})} {
		t.Run(fmt.Sprintf("invalid-%x", query), func(t *testing.T) {
			result, err := service.ListTags(ctx, owner, shortlink.TagCatalogInput{Query: query})
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
			require.Nil(t, result.Items)
		})
	}
}

type tagCatalogResolver struct {
	before   func()
	delegate permission.Resolver
}

// Resolve places a real database change after the entrance permission snapshot and before the directory SELECT.
func (r tagCatalogResolver) Resolve(ctx context.Context, key string) (permission.Snapshot, error) {
	snapshot, err := r.delegate.Resolve(ctx, key)
	r.before()
	return snapshot, err
}

// TestTagCatalogCurrentAuthorization catches trusting a stale session or entrance snapshot instead of the directory's current database grant.
func TestTagCatalogCurrentAuthorization(t *testing.T) {
	for _, tc := range []struct{ name, change string }{
		{"permission revoked", `update user_group set permissions='[]'`},
		{"disabled actor", `update app_user set status='disabled' where id=$1`},
		{"deleted actor", `update app_user set deleted_at=now() where id=$1`},
		{"guest group with grants", `update user_group set key='guest'`},
		{"moved to unprivileged group", `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values('00000000-0000-0000-0000-000000000402','restricted','Restricted','[]',false,now(),now()); update app_user set group_id='00000000-0000-0000-0000-000000000402'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			owner := insertShortLinkUser(t, ctx, pool, "current-owner", "user", permission.UserPermissions)
			id := insertStoredShortLink(t, ctx, pool, owner.ID, "currenttag", "https://example.com/current", "active", false)
			_, err := pool.Exec(ctx, `update short_link set tags=array['private'] where id=$1`, id)
			require.NoError(t, err)
			resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
				args := []any{}
				if strings.Contains(tc.change, "$1") {
					args = append(args, owner.ID)
				}
				_, err := pool.Exec(ctx, tc.change, args...)
				require.NoError(t, err)
			}}
			result, err := shortlink.NewService(pool, resolver).ListTags(ctx, owner, shortlink.TagCatalogInput{})
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.Nil(t, result.Items)
		})
	}
	t.Run("transfer at snapshot", func(t *testing.T) {
		ctx := t.Context()
		pool := shortLinkTestPool(t, ctx)
		insertShortLinkDefaultDomain(t, ctx, pool)
		owner := insertShortLinkUser(t, ctx, pool, "snapshot-owner", "user", permission.UserPermissions)
		other := insertShortLinkUserForGroup(t, ctx, pool, "snapshot-other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "user", permission.UserPermissions)
		id := insertStoredShortLink(t, ctx, pool, owner.ID, "snapshotlink", "https://example.com/snapshot", "active", false)
		_, err := pool.Exec(ctx, `update short_link set tags=array['transferred'] where id=$1`, id)
		require.NoError(t, err)
		resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
			_, err := pool.Exec(ctx, `update short_link set owner_id=$2 where id=$1`, id, other.ID)
			require.NoError(t, err)
		}}
		result, err := shortlink.NewService(pool, resolver).ListTags(ctx, owner, shortlink.TagCatalogInput{})
		require.NoError(t, err)
		require.Equal(t, shortlink.TagCatalogResult{Items: []shortlink.TagCatalogItem{}}, result)
	})
}

// TestTagCatalogRejectsInvalidActorsAndStorageFailure catches malformed actor identifiers, missing authorization and swallowed query cancellation.
func TestTagCatalogRejectsInvalidActorsAndStorageFailure(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "failure-owner", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	for _, id := range []string{"", "bad", uuid.Nil.String(), strings.ToUpper("af000000-0000-0000-0000-000000000001")} {
		actor := owner
		actor.ID = id
		result, err := service.ListTags(ctx, actor, shortlink.TagCatalogInput{})
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		require.Nil(t, result.Items)
	}
	result, err := service.ListTags(ctx, auth.GuestUser(), shortlink.TagCatalogInput{})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Nil(t, result.Items)
	result, err = shortlink.NewService(pool, nil).ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.Error(t, err)
	require.Nil(t, result.Items)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	result, err = service.ListTags(canceled, owner, shortlink.TagCatalogInput{})
	require.ErrorIs(t, err, context.Canceled)
	require.Nil(t, result.Items)
	pool.Close()
	result, err = service.ListTags(ctx, owner, shortlink.TagCatalogInput{})
	require.Error(t, err)
	require.Nil(t, result.Items)
}
