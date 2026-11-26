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

func TestChangeGroupSupportsCustomGroupAndUsesItsCurrentPermissions(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	customKey := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Operations','', $2::jsonb, false, now(), now())`, customKey, permissionsJSON([]string{permission.ShortLinkReadOwn}))
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	session, err := sessions.Create(t.Context(), id)
	require.NoError(t, err)

	result, err := service.ChangeGroup(t.Context(), actor, user.ChangeGroupInput{ID: id, GroupKey: customKey, ExpectedUpdatedAt: groupVersion(t, pool, id)})
	require.NoError(t, err)
	require.Equal(t, customKey, result.User.Group)
	_, err = sessions.Resolve(t.Context(), session.ID)
	require.ErrorIs(t, err, auth.ErrInvalidSession)
	fresh, err := sessions.Create(t.Context(), id)
	require.NoError(t, err)
	identity, err := auth.NewService(pool, time.Hour).Me(t.Context(), fresh.ID)
	require.NoError(t, err)
	require.Equal(t, customKey, identity.GroupKey)
	require.Equal(t, []string{permission.ShortLinkReadOwn}, identity.Permissions)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]'::jsonb where key=$1`, customKey)
	require.NoError(t, err)
	identity, err = auth.NewService(pool, time.Hour).Me(t.Context(), fresh.ID)
	require.NoError(t, err)
	require.Empty(t, identity.Permissions, "the next request must observe custom-group permission revocation")
}

func TestChangeGroupResponseRetainsSupplementalGroups(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	customKey := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Operations','', '[]'::jsonb, false, now(), now())`, customKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id)
		values ($1,(select id from user_group where key=$2))`, id, customKey)
	require.NoError(t, err)

	result, err := service.ChangeGroup(t.Context(), actor, user.ChangeGroupInput{
		ID: id, GroupKey: "admin", ExpectedUpdatedAt: groupVersion(t, pool, id),
	})
	require.NoError(t, err)
	require.Equal(t, "admin", result.User.Group)
	require.Equal(t, []user.GroupMembership{{Key: customKey, Name: "Operations"}}, result.User.SupplementalGroups)
}

func TestChangeGroupRejectsDestinationAlreadyInSupplementalSet(t *testing.T) {
	pool, service, actor, targetID := groupFixture(t)
	customKey := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Supplemental','', '[]'::jsonb,false,now(),now())`, customKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id)
		values ($1,(select id from user_group where key=$2))`, targetID, customKey)
	require.NoError(t, err)
	version := groupVersion(t, pool, targetID)

	_, err = service.ChangeGroup(t.Context(), actor, user.ChangeGroupInput{
		ID: targetID, GroupKey: customKey, ExpectedUpdatedAt: version,
	})
	require.ErrorIs(t, err, user.ErrInvalidInput, "a primary group cannot also remain in the supplemental set")
	require.Equal(t, version, groupVersion(t, pool, targetID), "rejected primary changes must leave the account version unchanged")
}

func TestUpdateGroupMembershipsReplacesCASAndRevokesSessions(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	const firstKey = "550e8400-e29b-41d4-a716-446655440090"
	const secondKey = "550e8400-e29b-41d4-a716-446655440091"
	_, err := pool.Exec(t.Context(), `
		insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values
			(gen_random_uuid(),$1,'Alpha','', '[]'::jsonb,false,now(),now()),
			(gen_random_uuid(),$2,'Beta','', '[]'::jsonb,false,now(),now())
	`, firstKey, secondKey)
	require.NoError(t, err)
	version := groupVersion(t, pool, id)
	sessions := auth.NewSessionService(pool, time.Hour)
	oldSession, err := sessions.Create(t.Context(), id)
	require.NoError(t, err)

	result, err := service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: id, GroupKeys: []string{secondKey, firstKey}, ExpectedUpdatedAt: version,
	})
	require.NoError(t, err)
	require.Equal(t, "user", result.User.Group)
	require.NotEqual(t, version, result.User.UpdatedAt)
	require.Equal(t, []user.GroupMembership{
		{Key: firstKey, Name: "Alpha"}, {Key: secondKey, Name: "Beta"},
	}, result.User.SupplementalGroups)
	_, err = sessions.Resolve(t.Context(), oldSession.ID)
	require.ErrorIs(t, err, auth.ErrInvalidSession)

	var auditCount int
	require.NoError(t, pool.QueryRow(t.Context(), `
		select count(*) from audit_log
		where actor_id=$1 and resource_type='user' and resource_id=$2 and action='update'
		and changed_fields=array['group_memberships']
	`, actor.ID, id).Scan(&auditCount))
	require.Equal(t, 1, auditCount)

	currentSession, err := sessions.Create(t.Context(), id)
	require.NoError(t, err)
	identity, err := auth.NewService(pool, time.Hour).Me(t.Context(), currentSession.ID)
	require.NoError(t, err)
	require.Equal(t, []string{firstKey, secondKey}, identity.SupplementalGroups)
	listed, err := service.List(t.Context(), actor, user.ListInput{})
	require.NoError(t, err)
	for _, item := range listed.Items {
		if item.ID == id {
			require.Equal(t, []user.GroupMembership{{Key: firstKey, Name: "Alpha"}, {Key: secondKey, Name: "Beta"}}, item.SupplementalGroups)
		}
	}
	noOp, err := service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: id, GroupKeys: []string{firstKey, secondKey}, ExpectedUpdatedAt: result.User.UpdatedAt,
	})
	require.NoError(t, err)
	require.Equal(t, result.User.UpdatedAt, noOp.User.UpdatedAt)
	_, err = sessions.Resolve(t.Context(), currentSession.ID)
	require.NoError(t, err, "an exact no-op must not revoke active sessions")
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id=$1 and changed_fields=array['group_memberships']`, id).Scan(&auditCount))
	require.Equal(t, 1, auditCount, "an exact no-op must not add an audit row")

	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: id, GroupKeys: []string{firstKey, secondKey}, ExpectedUpdatedAt: version,
	})
	require.ErrorIs(t, err, user.ErrVersionConflict, "a stale same-value request must conflict before no-op handling")
}

func TestUpdateGroupMembershipsRejectsBuiltinSelfDuplicateAndPrimaryGroup(t *testing.T) {
	pool, service, actor, targetID := groupFixture(t)
	const customKey = "550e8400-e29b-41d4-a716-446655440092"
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Supplemental','', '[]'::jsonb,false,now(),now())`, customKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='admin') where id=$1`, targetID)
	require.NoError(t, err)

	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: targetID, GroupKeys: []string{customKey}, ExpectedUpdatedAt: groupVersion(t, pool, targetID),
	})
	require.NoError(t, err, "a non-builtin account with the admin primary group remains eligible")

	version := groupVersion(t, pool, targetID)
	for _, keys := range [][]string{{customKey, customKey}, {"550E8400-E29B-41D4-A716-446655440092"}, {"550e8400-e29b-41d4-a716-446655440099"}} {
		_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{ID: targetID, GroupKeys: keys, ExpectedUpdatedAt: version})
		require.ErrorIs(t, err, user.ErrInvalidInput)
	}
	_, err = pool.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key=$1) where id=$2`, customKey, targetID)
	require.NoError(t, err)
	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: targetID, GroupKeys: []string{customKey}, ExpectedUpdatedAt: groupVersion(t, pool, targetID),
	})
	require.ErrorIs(t, err, user.ErrInvalidInput, "the primary group cannot be repeated in the supplemental set")

	builtinID := insertAppUser(t, t.Context(), pool, "builtin-membership-target", "", "Builtin", "user", "active", true)
	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: builtinID, GroupKeys: []string{customKey}, ExpectedUpdatedAt: groupVersion(t, pool, builtinID),
	})
	require.ErrorIs(t, err, user.ErrBuiltinUserImmutable)

	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: actor.ID, GroupKeys: []string{}, ExpectedUpdatedAt: groupVersion(t, pool, actor.ID),
	})
	require.ErrorIs(t, err, user.ErrSelfGroupChange)
}

func TestUpdateGroupMembershipsAuditFailureRollsBackMembersVersionAndSessions(t *testing.T) {
	pool, service, actor, targetID := groupFixture(t)
	const firstKey = "550e8400-e29b-41d4-a716-446655440093"
	const secondKey = "550e8400-e29b-41d4-a716-446655440094"
	_, err := pool.Exec(t.Context(), `
		insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values (gen_random_uuid(),$1,'First','', '[]'::jsonb,false,now(),now()), (gen_random_uuid(),$2,'Second','', '[]'::jsonb,false,now(),now())
	`, firstKey, secondKey)
	require.NoError(t, err)
	version := groupVersion(t, pool, targetID)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), targetID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `alter table audit_log add constraint reject_membership_audit check (changed_fields <> array['group_memberships']::text[]) not valid`)
	require.NoError(t, err)

	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: targetID, GroupKeys: []string{firstKey, secondKey}, ExpectedUpdatedAt: version,
	})
	require.Error(t, err)
	require.Equal(t, version, groupVersion(t, pool, targetID))
	var memberships int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user_group_membership where user_id=$1`, targetID).Scan(&memberships))
	require.Zero(t, memberships)
	_, err = auth.NewSessionService(pool, time.Hour).Resolve(t.Context(), session.ID)
	require.NoError(t, err, "audit failure must roll back session revocation")
}

func TestUpdateGroupMembershipsSecondInsertFailureRollsBackMembersVersionAndSessions(t *testing.T) {
	pool, service, actor, targetID := groupFixture(t)
	const firstKey = "550e8400-e29b-41d4-a716-446655440095"
	const secondKey = "550e8400-e29b-41d4-a716-446655440096"
	_, err := pool.Exec(t.Context(), `
		insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values ($1::uuid,$1,'First','', '[]'::jsonb,false,now(),now()), ($2::uuid,$2,'Second','', '[]'::jsonb,false,now(),now())
	`, firstKey, secondKey)
	require.NoError(t, err)
	version := groupVersion(t, pool, targetID)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), targetID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `alter table app_user_group_membership add constraint reject_second_membership_insert check (user_group_id <> '550e8400-e29b-41d4-a716-446655440096'::uuid) not valid`)
	require.NoError(t, err)

	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: targetID, GroupKeys: []string{firstKey, secondKey}, ExpectedUpdatedAt: version,
	})
	require.Error(t, err, "the second association insert must fail after the first one succeeds inside the transaction")
	require.Equal(t, version, groupVersion(t, pool, targetID))
	var memberships int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user_group_membership where user_id=$1`, targetID).Scan(&memberships))
	require.Zero(t, memberships, "the failed replacement must not leave its first association behind")
	var audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id=$1 and changed_fields=array['group_memberships']`, targetID).Scan(&audits))
	require.Zero(t, audits)
	_, err = auth.NewSessionService(pool, time.Hour).Resolve(t.Context(), session.ID)
	require.NoError(t, err, "a failed replacement must not revoke existing sessions")
}

func TestUpdateGroupMembershipsRejectsCorruptSupplementalPermissions(t *testing.T) {
	pool, service, actor, targetID := groupFixture(t)
	customKey := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Corrupt grant','', '["admin:access"]'::jsonb,false,now(),now())`, customKey)
	require.NoError(t, err)
	_, err = service.UpdateGroupMemberships(t.Context(), actor, user.UpdateGroupMembershipsInput{
		ID: targetID, GroupKeys: []string{customKey}, ExpectedUpdatedAt: groupVersion(t, pool, targetID),
	})
	require.Error(t, err, "a corrupt custom group must not be attached and later grant a protected permission")
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user_group_membership where user_id=$1`, targetID).Scan(&count))
	require.Zero(t, count)
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
	for _, prefix := range []string{"begin", "-- name: LockGroupChangeUsers", "-- name: GetUserGroupByID", "-- name: LockGroupChangeGroup", "-- name: LockUserGroupForCustomManagement", "-- name: ChangeAppUserGroup", "-- name: RevokeGroupChangeSessions", "commit"} {
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
