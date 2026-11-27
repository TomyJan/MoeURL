package user_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// TestProfileResponseKeepsSupplementalPermissions verifies nickname saves never replace the client's identity with primary-only grants.
func TestProfileResponseKeepsSupplementalPermissions(t *testing.T) {
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", []string{})
	_, err := pool.Exec(ctx, `update user_group set builtin=true where key='user'`)
	require.NoError(t, err)
	id := insertAppUser(t, ctx, pool, "profile-member", "hash", "Original", "user", "active", false)
	keys := []string{"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
		(gen_random_uuid(),$1,'Operations','["short_link:create","short_link:read_own"]',false,now(),now()),
		(gen_random_uuid(),$2,'Support','["short_link:read_own","short_link:use_intermediate"]',false,now(),now())`, keys[0], keys[1])
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user_group_membership(user_id,user_group_id)
		select $1::uuid,id from user_group where key=any($2::text[])`, id, keys)
	require.NoError(t, err)
	service := user.NewService(pool, permission.NewService())
	actor := auth.CurrentUser{ID: id, Username: "stale-name", GroupKey: "user", Permissions: []string{permission.AdminAccess}}
	result, err := service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: "Saved"})
	require.NoError(t, err)
	t.Run("current union", func(t *testing.T) {
		require.ElementsMatch(t, []string{permission.ShortLinkCreate, permission.ShortLinkReadOwn, permission.ShortLinkUseIntermediate}, result.User.Permissions)
		require.Equal(t, keys, result.User.SupplementalGroups)
		require.Equal(t, "profile-member", result.User.Username)
	})
	t.Run("corrupt supplemental group rolls the nickname back", func(t *testing.T) {
		_, err := pool.Exec(ctx, `update user_group set permissions='{"invalid":"permission array"}'::jsonb where key=$1`, keys[1])
		require.NoError(t, err)
		_, err = service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: "Must roll back"})
		require.Error(t, err)
		var nickname string
		require.NoError(t, pool.QueryRow(ctx, `select nickname from app_user where id=$1`, id).Scan(&nickname))
		require.Equal(t, "Saved", nickname)
	})
}
