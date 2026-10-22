package usergroup

import (
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestUserGroupAuditPermissionSets distinguishes real grant changes from normalization after setup or upgrade.
func TestUserGroupAuditPermissionSets(t *testing.T) {
	for _, mode := range []string{"initialized", "upgraded"} {
		t.Run(mode, func(t *testing.T) {
			ctx := t.Context()
			url := testdb.DatabaseURL(ctx, t)
			database, err := sql.Open("pgx", url)
			require.NoError(t, err)
			t.Cleanup(func() { require.NoError(t, database.Close()) })
			require.NoError(t, goose.SetDialect("postgres"))
			dir := filepath.Join("..", "..", "migrations")
			version := int64(21)
			if mode == "upgraded" {
				version = 19
			}
			require.NoError(t, goose.UpTo(database, dir, version))
			for key, grants := range map[string][]string{"user": permission.UserPermissions, "admin": permission.AdminPermissions} {
				stored := make([]string, 0, len(grants))
				for _, grant := range grants {
					if mode == "upgraded" && (grant == permission.ShortLinkReadVisits || grant == permission.StatisticsReadAll || grant == permission.AuditRead) {
						continue
					}
					stored = append(stored, grant)
				}
				data, err := json.Marshal(stored)
				require.NoError(t, err)
				_, err = database.ExecContext(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),$1,$1,$2,true,now(),now())`, key, data)
				require.NoError(t, err)
			}
			if mode == "upgraded" {
				require.NoError(t, goose.UpTo(database, dir, 21))
			}
			pool, err := pgxpool.New(ctx, url)
			require.NoError(t, err)
			t.Cleanup(pool.Close)
			actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "admin"}
			_, err = pool.Exec(ctx, `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) select $1,'audit-admin','Admin',id,'active',false,now(),now() from user_group where key='admin'`, actor.ID)
			require.NoError(t, err)
			service := NewService(pool, permission.NewDatabaseService(pool))
			listed, err := service.List(ctx, actor)
			require.NoError(t, err)
			require.Len(t, listed.Groups, 2)
			for _, group := range listed.Groups {
				t.Run(group.Key, func(t *testing.T) {
					input := UpdatePermissionsInput{GroupKey: group.Key, Permissions: group.Permissions, ExpectedUpdatedAt: group.UpdatedAt}
					// A GET/POST round trip may reorder storage but does not change authorization.
					saved, err := service.UpdatePermissions(ctx, actor, input)
					require.NoError(t, err)
					var count int
					require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_type='user_group' and resource_id=(select id::text from user_group where key=$1)`, group.Key).Scan(&count))
					require.Zero(t, count, "unchanged permission membership must not produce an audit")
					removed := make([]string, 0, len(group.Permissions)-1)
					for _, grant := range group.Permissions {
						if grant != permission.ShortLinkCreate {
							removed = append(removed, grant)
						}
					}
					for _, change := range []struct {
						grants []string
						count  int
					}{{removed, 1}, {removed, 1}, {group.Permissions, 2}} {
						input.Permissions, input.ExpectedUpdatedAt = change.grants, saved.Group.UpdatedAt
						saved, err = service.UpdatePermissions(ctx, actor, input)
						require.NoError(t, err)
						require.ElementsMatch(t, change.grants, saved.Group.Permissions)
						require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_type='user_group' and resource_id=(select id::text from user_group where key=$1) and actor_id=$2 and action='permissions_change' and changed_fields=array['permissions']`, group.Key, actor.ID).Scan(&count))
						require.Equal(t, change.count, count)
					}
				})
			}
		})
	}
}
