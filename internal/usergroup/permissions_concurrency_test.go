package usergroup

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// permissionWriterFixture persists both authorization groups and the actual actor.
func permissionWriterFixture(t *testing.T) (*Service, *pgxpool.Pool, auth.CurrentUser, UpdatePermissionsInput) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	for key, grants := range map[string][]string{"admin": permission.AdminPermissions, "user": permission.UserPermissions} {
		encoded, err := json.Marshal(grants)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at)
			values(gen_random_uuid(),$1,$1,$2,true,now(),'2026-10-27T01:02:03.123456Z')`, key, encoded)
		require.NoError(t, err)
	}
	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "admin"}
	_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'writer','Writer',id,'active',false,now(),now() from user_group where key='admin'`, actor.ID)
	require.NoError(t, err)
	return NewService(pool, permission.NewDatabaseService(pool)), pool, actor, UpdatePermissionsInput{
		GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: "2026-10-27T01:02:03.123456Z",
	}
}

// Catches writes authorized from a stale actor/group snapshot after a completed revocation.
func TestPermissionWriteCurrentAuthorizationQueue(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		query string
	}{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=clock_timestamp() where id=$1`},
		{"moved", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"admin revoked", `update user_group set permissions=permissions-'admin:access' where key='admin' and exists(select 1 from app_user where id=$1)`},
		{"admin no longer builtin", `update user_group set builtin=false where key='admin' and exists(select 1 from app_user where id=$1)`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, pool, actor, input := permissionWriterFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			gate, err := pool.Begin(ctx)
			require.NoError(t, err)
			t.Cleanup(func() { _ = gate.Rollback(context.Background()) })
			// Hold both the old target-row boundary and the new domain prefix.
			// Revocation completes before either implementation may authorize and write.
			_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
			require.NoError(t, err)
			_, err = gate.Exec(ctx, `select id from user_group where key='user' for no key update`)
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() {
				_, writeErr := s.UpdatePermissions(ctx, actor, input)
				result <- writeErr
			}()
			waitForPermissionWriterLock(t, ctx, pool)
			_, err = pool.Exec(ctx, scenario.query, actor.ID)
			require.NoError(t, err)
			require.NoError(t, gate.Rollback(ctx))
			select {
			case err = <-result:
			case <-ctx.Done():
				t.Fatal("queued permission write did not finish")
			}
			require.ErrorIs(t, err, ErrPermissionDenied)
			assertPermissionTargetUnchanged(t, pool)
		})
	}
}

// Catches PostgreSQL timestamp truncation turning a stale revision into a successful write.
func TestPermissionWriteExactRevision(t *testing.T) {
	for _, scenario := range []struct {
		name string
		at   string
		want error
	}{
		{"one nanosecond stale", "2026-10-27T01:02:03.123456001Z", ErrPermissionConflict},
		{"over nanosecond precision", "2026-10-27T01:02:03.1234560001Z", ErrInvalidInput},
		{"equivalent timezone", "2026-10-27T09:02:03.123456+08:00", nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, pool, actor, input := permissionWriterFixture(t)
			input.ExpectedUpdatedAt = scenario.at
			result, err := s.UpdatePermissions(t.Context(), actor, input)
			if scenario.want != nil {
				require.ErrorIs(t, err, scenario.want)
				assertPermissionTargetUnchanged(t, pool)
				return
			}
			require.NoError(t, err)
			require.Empty(t, result.Group.Permissions)
			require.NotEqual(t, "2026-10-27T01:02:03.123456Z", result.Group.UpdatedAt)
		})
	}
}

// assertPermissionTargetUnchanged checks all externally persisted effects of a rejected update.
func assertPermissionTargetUnchanged(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	var stored []byte
	var at time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select permissions,updated_at from user_group where key='user'`).Scan(&stored, &at))
	var grants []string
	require.NoError(t, json.Unmarshal(stored, &grants))
	require.ElementsMatch(t, permission.UserPermissions, grants)
	require.Equal(t, "2026-10-27T01:02:03.123456Z", at.UTC().Format(time.RFC3339Nano))
	var audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
	require.Zero(t, audits)
}

// waitForPermissionWriterLock observes an actual database wait instead of guessing with a delay.
func waitForPermissionWriterLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	waitForConfigurationLockWaiters(t, ctx, pool, 1)
}

// waitForConfigurationLockWaiters observes both sides of a deliberately ordered transaction race.
func waitForConfigurationLockWaiters(t *testing.T, ctx context.Context, pool *pgxpool.Pool, want int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from pg_stat_activity
			where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`).Scan(&count))
		if count >= want {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatal("permission writer never reached the database lock")
		}
	}
}
