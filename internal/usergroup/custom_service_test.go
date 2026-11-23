package usergroup

import (
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

func TestNormalizeCustomGroupDetails(t *testing.T) {
	tests := []struct {
		name        string
		title       string
		description string
		wantTitle   string
		wantDesc    string
		wantErr     bool
	}{
		{name: "trims title and preserves description", title: "  操作员组  ", description: "  负责平台运维  ", wantTitle: "操作员组", wantDesc: "  负责平台运维  "},
		{name: "rejects whitespace-only title", title: " \t ", wantErr: true},
		{name: "allows 64 unicode title characters", title: strings.Repeat("组", 64), wantTitle: strings.Repeat("组", 64)},
		{name: "rejects title over 64 unicode characters", title: strings.Repeat("组", 65), wantErr: true},
		{name: "allows 500 unicode description characters", title: "组", description: strings.Repeat("说", 500), wantTitle: "组", wantDesc: strings.Repeat("说", 500)},
		{name: "rejects description over 500 unicode characters", title: "组", description: strings.Repeat("说", 501), wantErr: true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			title, description, err := normalizeCustomGroupDetails(test.title, test.description)
			if test.wantErr {
				require.ErrorIs(t, err, ErrInvalidInput)
				return
			}
			require.NoError(t, err)
			require.Equal(t, test.wantTitle, title)
			require.Equal(t, test.wantDesc, description)
		})
	}
}

func TestUserGroupFromRowProjectsCustomPermissions(t *testing.T) {
	updatedAt := time.Date(2026, 11, 23, 7, 30, 0, 123456000, time.UTC)
	group, err := userGroupFromRow(sqlc.UserGroup{
		Key:         "550e8400-e29b-41d4-a716-446655440001",
		Name:        "Operations",
		Description: "Operational access",
		Permissions: []byte(`[` + `"` + permission.ShortLinkReadOwn + `","` + permission.ShortLinkCreate + `"]`),
		Builtin:     false,
		UpdatedAt:   pgtype.Timestamptz{Time: updatedAt, Valid: true},
	})
	require.NoError(t, err)
	require.Equal(t, "550e8400-e29b-41d4-a716-446655440001", group.Key)
	require.False(t, group.Builtin)
	require.True(t, group.Editable)
	require.Equal(t, []string{permission.ShortLinkCreate, permission.ShortLinkReadOwn}, group.Permissions)
}

func TestUserGroupFromRowRejectsReservedBuiltinKeyMarkedCustom(t *testing.T) {
	_, err := userGroupFromRow(sqlc.UserGroup{
		Key:         permission.GroupUser,
		Permissions: []byte(`[]`),
		Builtin:     false,
	})
	require.Error(t, err)
}

func TestCustomServiceCreatePermissionUpdateAndDelete(t *testing.T) {
	_, pool, actor, _ := permissionWriterFixture(t)
	service := NewCustomService(pool)
	_, err := service.Delete(t.Context(), actor, DeleteCustomGroupInput{GroupKey: permission.GroupUser, ExpectedUpdatedAt: "2026-10-27T01:02:03.123456Z"})
	require.ErrorIs(t, err, ErrProtectedGroup)

	created, err := service.Create(t.Context(), actor, CreateCustomGroupInput{Name: "  Operations  ", Description: "Platform access"})
	require.NoError(t, err)
	require.Regexp(t, `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`, created.Group.Key)
	require.Equal(t, "Operations", created.Group.Name)
	require.False(t, created.Group.Builtin)
	require.True(t, created.Group.Editable)
	require.Empty(t, created.Group.Permissions)

	_, err = service.Create(t.Context(), actor, CreateCustomGroupInput{Name: "operations", Description: "Duplicate"})
	require.ErrorIs(t, err, ErrUserGroupNameConflict)
	memberID := uuid.NewString()
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at,deleted_at)
		select $1,'soft-deleted-custom-member','Member',id,'active',false,now(),now(),now() from user_group where key=$2`, memberID, created.Group.Key)
	require.NoError(t, err)

	_, err = service.UpdatePermissions(t.Context(), actor, UpdatePermissionsInput{
		GroupKey: created.Group.Key, Permissions: []string{permission.AdminAccess}, ExpectedUpdatedAt: created.Group.UpdatedAt,
	})
	require.ErrorIs(t, err, ErrProtectedPermission)

	updated, err := service.UpdatePermissions(t.Context(), actor, UpdatePermissionsInput{
		GroupKey: created.Group.Key, Permissions: []string{permission.ShortLinkReadOwn, permission.ShortLinkCreate}, ExpectedUpdatedAt: created.Group.UpdatedAt,
	})
	require.NoError(t, err)
	require.Equal(t, []string{permission.ShortLinkCreate, permission.ShortLinkReadOwn}, updated.Group.Permissions)
	require.EqualValues(t, 1, updated.Group.MemberCount)

	stale, err := service.UpdateDetails(t.Context(), actor, UpdateCustomGroupDetailsInput{
		GroupKey: created.Group.Key, Name: "Ops", Description: "Updated", ExpectedUpdatedAt: created.Group.UpdatedAt,
	})
	require.ErrorIs(t, err, ErrPermissionConflict)
	require.Empty(t, stale.Group.Key)

	renamed, err := service.UpdateDetails(t.Context(), actor, UpdateCustomGroupDetailsInput{
		GroupKey: created.Group.Key, Name: "  Operations Team  ", Description: "Updated", ExpectedUpdatedAt: updated.Group.UpdatedAt,
	})
	require.NoError(t, err)
	require.Equal(t, "Operations Team", renamed.Group.Name)
	require.EqualValues(t, 1, renamed.Group.MemberCount)
	_, err = service.Delete(t.Context(), actor, DeleteCustomGroupInput{GroupKey: created.Group.Key, ExpectedUpdatedAt: updated.Group.UpdatedAt})
	require.ErrorIs(t, err, ErrPermissionConflict)

	_, err = service.Delete(t.Context(), actor, DeleteCustomGroupInput{GroupKey: created.Group.Key, ExpectedUpdatedAt: renamed.Group.UpdatedAt})
	require.ErrorIs(t, err, ErrUserGroupHasMembers, "soft-deleted accounts still reference their group")

	emptyGroup, err := service.Create(t.Context(), actor, CreateCustomGroupInput{Name: "Empty"})
	require.NoError(t, err)
	deleted, err := service.Delete(t.Context(), actor, DeleteCustomGroupInput{GroupKey: emptyGroup.Group.Key, ExpectedUpdatedAt: emptyGroup.Group.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, emptyGroup.Group.Key, deleted.GroupKey)
	require.Equal(t, "Empty", deleted.Name)
	var remaining int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_group where key=$1`, deleted.GroupKey).Scan(&remaining))
	require.Zero(t, remaining)
}

func TestCustomServiceRechecksCurrentDatabaseAuthorization(t *testing.T) {
	_, pool, actor, _ := permissionWriterFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions = permissions - 'admin:access' where key = 'admin'`)
	require.NoError(t, err)

	_, err = NewCustomService(pool).Create(t.Context(), actor, CreateCustomGroupInput{Name: "Should not exist"})
	require.ErrorIs(t, err, ErrPermissionDenied)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_group where lower(name) = lower('Should not exist')`).Scan(&count))
	require.Zero(t, count)
}
