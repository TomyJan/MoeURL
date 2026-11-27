package auth_test

import (
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/stretchr/testify/require"
)

// TestAuthIdentityReturnsCurrentSupplementalPermissions protects every client identity from a primary-only permission projection.
func TestAuthIdentityReturnsCurrentSupplementalPermissions(t *testing.T) {
	ctx := t.Context()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "supplemental-alice", "correct-password", "active")
	keys := []string{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		(gen_random_uuid(),$1,'Operations','["short_link:create","short_link:read_own"]',false,now(),now()),
		(gen_random_uuid(),$2,'Support','["short_link:read_own","short_link:use_intermediate"]',false,now(),now())`, keys[0], keys[1])
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user_group_membership(user_id,user_group_id)
		select app_user.id,user_group.id from app_user cross join user_group
		where app_user.username='supplemental-alice' and user_group.key=any($1::text[])`, keys)
	require.NoError(t, err)
	service := auth.NewService(pool, time.Hour)
	login, err := service.Login(ctx, auth.LoginInput{Username: "supplemental-alice", Password: "correct-password"})
	require.NoError(t, err)
	want := []string{permission.ShortLinkCreate, permission.ShortLinkReadOwn, permission.ShortLinkUseIntermediate}
	t.Run("login", func(t *testing.T) {
		require.ElementsMatch(t, want, login.User.Permissions)
		require.Equal(t, keys, login.User.SupplementalGroups)
	})
	t.Run("me", func(t *testing.T) {
		current, err := service.Me(ctx, login.Session.ID)
		require.NoError(t, err)
		require.ElementsMatch(t, want, current.Permissions)
		require.Equal(t, keys, current.SupplementalGroups)
	})
	t.Run("corrupt supplemental permissions reject login and identity", func(t *testing.T) {
		_, err := pool.Exec(ctx, `update user_group set permissions='{"invalid":"permission array"}'::jsonb where key=$1`, keys[1])
		require.NoError(t, err)
		_, err = service.Me(ctx, login.Session.ID)
		require.Error(t, err)
		var before, after int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from session`).Scan(&before))
		_, err = service.Login(ctx, auth.LoginInput{Username: "supplemental-alice", Password: "correct-password"})
		require.Error(t, err)
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from session`).Scan(&after))
		require.Equal(t, before, after, "invalid permission storage must not mint a session")
	})
}
