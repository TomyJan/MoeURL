package usergroup

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestMain releases the package's real PostgreSQL container after transactional tests.
func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }

// TestUserGroupAuditCommitAndRollback exercises the production transaction store, including audit failure.
func TestUserGroupAuditCommitAndRollback(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	ctx := t.Context()
	data, err := json.Marshal(permission.UserPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'user','User',$1,true,now(),now())`, data)
	require.NoError(t, err)
	var at time.Time
	require.NoError(t, pool.QueryRow(ctx, `select updated_at from user_group where key='user'`).Scan(&at))
	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "admin"}
	service := NewService(pool, permission.NewService())
	input := UpdatePermissionsInput{GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: at.Format(time.RFC3339Nano)}
	_, err = pool.Exec(ctx, `alter table audit_log add constraint audit_failure check(false) not valid`)
	require.NoError(t, err)
	_, err = service.UpdatePermissions(ctx, actor, input)
	require.Error(t, err)
	var unchanged bool
	require.NoError(t, pool.QueryRow(ctx, `select permissions=$1 from user_group where key='user'`, data).Scan(&unchanged))
	require.True(t, unchanged)
	_, err = pool.Exec(ctx, `alter table audit_log drop constraint audit_failure`)
	require.NoError(t, err)
	_, err = service.UpdatePermissions(ctx, actor, input)
	require.NoError(t, err)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='user_group' and action='permissions_change' and changed_fields=array['permissions']`, actor.ID).Scan(&count))
	require.Equal(t, 1, count)
}
