package user_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// groupFixture creates real accounts and groups without trusting an entry-point permission snapshot.
func groupFixture(t *testing.T) (*pgxpool.Pool, *user.Service, auth.CurrentUser, string) {
	t.Helper()
	pool := userTestPool(t, t.Context())
	insertUserGroup(t, t.Context(), pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, t.Context(), pool, "user", permission.UserPermissions)
	insertUserGroup(t, t.Context(), pool, "guest", nil)
	_, err := pool.Exec(t.Context(), `update user_group set builtin=true`)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "manager", "", "Manager", "admin", "active", false), GroupKey: "admin"}
	target := insertAppUser(t, t.Context(), pool, "member", "", "Member", "user", "active", false)
	return pool, user.NewService(pool, permission.NewDatabaseService(pool)), actor, target
}

// groupVersion obtains the database's full precision optimistic-concurrency token.
func groupVersion(t *testing.T, pool *pgxpool.Pool, id string) string {
	t.Helper()
	var at time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from app_user where id=$1`, id).Scan(&at))
	return at.UTC().Format(time.RFC3339Nano)
}

// TestChangeGroup catches missing atomic revocation, fake audit changes and loss of timestamp precision.
func TestChangeGroup(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	ctx := t.Context()
	sessions := auth.NewSessionService(pool, time.Hour)
	for _, group := range []string{"admin", "user"} {
		first, err := sessions.Create(ctx, id)
		require.NoError(t, err)
		second, err := sessions.Create(ctx, id)
		require.NoError(t, err)
		before := groupVersion(t, pool, id)
		listed, err := service.List(ctx, actor, user.ListInput{})
		require.NoError(t, err)
		for _, item := range listed.Items {
			if item.ID == id {
				require.Equal(t, before, item.UpdatedAt)
			}
		}
		result, err := service.ChangeGroup(ctx, actor, user.ChangeGroupInput{ID: id, GroupKey: group, ExpectedUpdatedAt: before})
		require.NoError(t, err)
		require.Equal(t, group, result.User.Group)
		require.NotEqual(t, before, result.User.UpdatedAt)
		for _, token := range []string{first.ID, second.ID} {
			_, err := sessions.Resolve(ctx, token)
			require.ErrorIs(t, err, auth.ErrInvalidSession)
		}
		_, err = service.ChangeGroup(ctx, actor, user.ChangeGroupInput{ID: id, GroupKey: group, ExpectedUpdatedAt: before})
		require.ErrorIs(t, err, user.ErrVersionConflict)
		current, err := sessions.Create(ctx, id)
		require.NoError(t, err)
		identity, err := auth.NewService(pool, time.Hour).Me(ctx, current.ID)
		require.NoError(t, err)
		require.Equal(t, group, identity.GroupKey)
		require.Equal(t, group == "admin", containsString(identity.Permissions, "admin:access"))
		noop, err := service.ChangeGroup(ctx, actor, user.ChangeGroupInput{ID: id, GroupKey: group, ExpectedUpdatedAt: result.User.UpdatedAt})
		require.NoError(t, err)
		require.Equal(t, result.User.UpdatedAt, noop.User.UpdatedAt)
		_, err = sessions.Resolve(ctx, current.ID)
		require.NoError(t, err)
	}
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and actor_id=$2 and action='update' and changed_fields=array['group_id']`, id, actor.ID).Scan(&count))
	require.Equal(t, 2, count)
}

// TestChangeGroupGuards prevents forged entry-point roles, protected account edits and stale writes.
func TestChangeGroupGuards(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	valid := user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id)}
	for _, input := range []user.ChangeGroupInput{
		{}, {ID: uuid.Nil.String(), GroupKey: "admin", ExpectedUpdatedAt: valid.ExpectedUpdatedAt},
		{ID: id, GroupKey: "guest", ExpectedUpdatedAt: valid.ExpectedUpdatedAt},
		{ID: id, GroupKey: "ADMIN", ExpectedUpdatedAt: valid.ExpectedUpdatedAt},
		{ID: id, GroupKey: "admin", ExpectedUpdatedAt: "bad"},
	} {
		_, err := service.ChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrInvalidInput)
	}
	_, err := service.ChangeGroup(t.Context(), auth.GuestUser(), valid)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = service.ChangeGroup(t.Context(), auth.CurrentUser{ID: id, GroupKey: "admin"}, valid)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	own := valid
	own.ID = actor.ID
	own.ExpectedUpdatedAt = groupVersion(t, pool, actor.ID)
	_, err = service.ChangeGroup(t.Context(), actor, own)
	require.ErrorIs(t, err, user.ErrSelfGroupChange)
	missing := valid
	missing.ID = uuid.NewString()
	_, err = service.ChangeGroup(t.Context(), actor, missing)
	require.ErrorIs(t, err, user.ErrUserNotFound)
	for _, statement := range []string{`update app_user set builtin=true where id=$1`, `update app_user set builtin=false,deleted_at=now() where id=$1`} {
		_, err = pool.Exec(t.Context(), statement, id)
		require.NoError(t, err)
		_, err = service.ChangeGroup(t.Context(), actor, valid)
		if statement == `update app_user set builtin=true where id=$1` {
			require.ErrorIs(t, err, user.ErrBuiltinUserImmutable)
		} else {
			require.ErrorIs(t, err, user.ErrUserNotFound)
		}
	}
	_, err = pool.Exec(t.Context(), `update app_user set deleted_at=null where id=$1`, id)
	require.NoError(t, err)
	for _, statement := range []string{`update app_user set status='disabled' where id=$1`, `update app_user set status='active',group_id=(select id from user_group where key='user') where id=$1`, `update app_user set deleted_at=now() where id=$1`} {
		_, err = pool.Exec(t.Context(), statement, actor.ID)
		require.NoError(t, err)
		_, err = service.ChangeGroup(t.Context(), actor, valid)
		require.ErrorIs(t, err, user.ErrPermissionDenied)
	}
}

// TestChangeGroupAuditRollback verifies an audit failure cannot leave elevated privileges or revoked sessions.
func TestChangeGroupAuditRollback(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), id)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `alter table audit_log add constraint reject_change check (false) not valid`)
	require.NoError(t, err)
	_, err = service.ChangeGroup(t.Context(), actor, user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id)})
	require.Error(t, err)
	identity, err := auth.NewService(pool, time.Hour).Me(t.Context(), session.ID)
	require.NoError(t, err)
	require.Equal(t, "user", identity.GroupKey)
}

// TestChangeGroupConcurrentVersion ensures two requests using the same version cannot both mutate the account.
func TestChangeGroupConcurrentVersion(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	input := user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id)}
	start := make(chan struct{})
	results := make(chan error, 2)
	var workers sync.WaitGroup
	for range 2 {
		workers.Go(func() { <-start; _, err := service.ChangeGroup(t.Context(), actor, input); results <- err })
	}
	close(start)
	workers.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else {
			require.ErrorIs(t, err, user.ErrVersionConflict)
			conflict++
		}
	}
	require.Equal(t, 1, success)
	require.Equal(t, 1, conflict)
}

// TestChangeGroupCancellation rejects canceled operations without writing any audit.
func TestChangeGroupCancellation(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := service.ChangeGroup(ctx, actor, user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id)})
	require.Error(t, err)
}

type groupFaultTracer struct{ prefix string }

// TraceQueryStart injects a real cancellation at a specific SQL boundary without replacing the store.
func (tr groupFaultTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.HasPrefix(data.SQL, tr.prefix) {
		ctx, cancel := context.WithCancel(ctx)
		cancel()
		return ctx
	}
	return ctx
}

// TraceQueryEnd leaves the real driver's outcome unchanged.
func (groupFaultTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestChangeGroupDatabaseFailures covers actual transaction failures and verifies no partial privilege change.
func TestChangeGroupDatabaseFailures(t *testing.T) {
	pool, _, actor, id := groupFixture(t)
	version := groupVersion(t, pool, id)
	for _, prefix := range []string{"begin", "-- name: LockGroupChangeUsers", "-- name: GetUserGroupByID", "-- name: GetGroupChangeGroup", "-- name: GetUserGroupByKey", "-- name: ChangeAppUserGroup", "-- name: RevokeGroupChangeSessions", "commit"} {
		t.Run(prefix, func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = groupFaultTracer{prefix}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(faulty.Close)
			_, err = user.NewService(faulty, permission.NewDatabaseService(faulty)).ChangeGroup(t.Context(), actor, user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: version})
			require.Error(t, err)
			require.Equal(t, version, groupVersion(t, pool, id))
		})
	}
}

// TestChangeGroupStoredState rejects malformed grants and unsupported destination groups instead of guessing.
func TestChangeGroupStoredState(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	input := user.ChangeGroupInput{ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id)}
	_, err := service.ChangeGroup(t.Context(), auth.CurrentUser{ID: uuid.NewString()}, input)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='{}'::jsonb where key='admin'`)
	require.NoError(t, err)
	_, err = service.ChangeGroup(t.Context(), actor, input)
	require.Error(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]'::jsonb where key='admin'`)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set builtin=false where key='user'`)
	require.NoError(t, err)
	input.GroupKey = "user"
	_, err = service.ChangeGroup(t.Context(), actor, input)
	require.ErrorIs(t, err, user.ErrInvalidInput)
	_, err = pool.Exec(t.Context(), `update user_group set key='formerly-user' where key='user'`)
	require.NoError(t, err)
	_, err = service.ChangeGroup(t.Context(), actor, input)
	require.ErrorIs(t, err, user.ErrInvalidInput)
}
