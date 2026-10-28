package user_test

import (
	"context"
	"fmt"
	"slices"
	"strings"
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

// batchItems captures the database's unrounded versions without deriving expected results from the command.
func batchItems(t *testing.T, pool *pgxpool.Pool, ids ...string) []user.BatchChangeGroupItem {
	t.Helper()
	items := make([]user.BatchChangeGroupItem, len(ids))
	for i, id := range ids {
		items[i] = user.BatchChangeGroupItem{ID: id, ExpectedUpdatedAt: groupVersion(t, pool, id)}
	}
	return items
}

// TestBatchChangeGroup preserves unchanged members' sessions/versions while atomically changing disabled members too.
func TestBatchChangeGroup(t *testing.T) {
	pool, service, actor, first := groupFixture(t)
	second := insertAppUser(t, t.Context(), pool, "already-admin", "", "Second", "admin", "active", false)
	_, err := pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, first)
	require.NoError(t, err)
	sessions := auth.NewSessionService(pool, time.Hour)
	oldFirst, err := sessions.Create(t.Context(), first)
	require.NoError(t, err)
	oldSecond, err := sessions.Create(t.Context(), second)
	require.NoError(t, err)
	items := batchItems(t, pool, first, second)
	result, err := service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: items, GroupKey: "admin"})
	require.NoError(t, err)
	require.Equal(t, user.BatchChangeGroupResult{ChangedCount: 1, UnchangedCount: 1}, result)
	require.NotEqual(t, items[0].ExpectedUpdatedAt, groupVersion(t, pool, first))
	require.Equal(t, items[1].ExpectedUpdatedAt, groupVersion(t, pool, second))
	var group, status string
	require.NoError(t, pool.QueryRow(t.Context(), `select g.key,u.status from app_user u join user_group g on g.id=u.group_id where u.id=$1`, first).Scan(&group, &status))
	require.Equal(t, "admin", group)
	require.Equal(t, "disabled", status)
	_, err = sessions.Resolve(t.Context(), oldFirst.ID)
	require.ErrorIs(t, err, auth.ErrInvalidSession)
	_, err = sessions.Resolve(t.Context(), oldSecond.ID)
	require.NoError(t, err)
	// A stale no-op must still reject the entire request, including all counts.
	result, err = service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: items, GroupKey: "admin"})
	require.ErrorIs(t, err, user.ErrVersionConflict)
	require.Equal(t, user.BatchChangeGroupResult{}, result)
	current := batchItems(t, pool, first, second)
	result, err = service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: current, GroupKey: "admin"})
	require.NoError(t, err)
	require.Equal(t, user.BatchChangeGroupResult{ChangedCount: 0, UnchangedCount: 2}, result)
	require.Equal(t, current, batchItems(t, pool, first, second))
	_, err = sessions.Resolve(t.Context(), oldSecond.ID)
	require.NoError(t, err)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_type='user' and actor_id=$1 and action='update' and changed_fields=array['group_id']`, actor.ID).Scan(&count))
	require.Equal(t, 1, count)
}

// TestBatchChangeGroupSyntax prevents ambiguous IDs/timestamps, silent deduplication and an unbounded transaction.
func TestBatchChangeGroupSyntax(t *testing.T) {
	service := user.NewService(nil, nil) // Every invalid input must fail before any database access.
	actor := auth.CurrentUser{ID: "00000000-0000-4000-8000-000000000001"}
	valid := user.BatchChangeGroupItem{ID: "00000000-0000-4000-8000-abcdefabcdef", ExpectedUpdatedAt: "2026-10-28T01:02:03.123456Z"}
	cases := []user.BatchChangeGroupInput{{}, {GroupKey: "admin"}, {Items: []user.BatchChangeGroupItem{valid}, GroupKey: "guest"}, {Items: []user.BatchChangeGroupItem{valid, valid}, GroupKey: "user"}, {Items: make([]user.BatchChangeGroupItem, 101), GroupKey: "admin"}}
	for _, id := range []string{"", "broken", uuid.Nil.String(), strings.ToUpper(valid.ID), "00000000000040008000abcdefabcdef"} {
		item := valid
		item.ID = id
		cases = append(cases, user.BatchChangeGroupInput{Items: []user.BatchChangeGroupItem{item}, GroupKey: "user"})
	}
	for _, at := range []string{"", "bad", "0001-01-01T00:00:00Z", "2026-10-28T01:02:03.1234567890Z", "2026-10-28T01:02:03,123Z", "2026-10-28T1:02:03Z", "2026-10-28T01:02:03+24:00", "2026-10-28T01:02:03+01:60", "2026-02-30T01:02:03Z"} {
		item := valid
		item.ExpectedUpdatedAt = at
		cases = append(cases, user.BatchChangeGroupInput{Items: []user.BatchChangeGroupItem{item}, GroupKey: "user"})
	}
	for _, input := range cases {
		result, err := service.BatchChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrInvalidInput, "%+v", input)
		require.Equal(t, user.BatchChangeGroupResult{}, result)
	}
	for _, id := range []string{"", uuid.Nil.String(), "broken", strings.ToUpper(valid.ID)} {
		_, err := service.BatchChangeGroup(t.Context(), auth.CurrentUser{ID: id}, user.BatchChangeGroupInput{Items: []user.BatchChangeGroupItem{valid}, GroupKey: "admin"})
		require.ErrorIs(t, err, user.ErrPermissionDenied)
	}
}

// TestBatchChangeGroupTimeAndLimit accepts equivalent offsets and all 100 members without losing precision.
func TestBatchChangeGroupTimeAndLimit(t *testing.T) {
	pool, service, actor, first := groupFixture(t)
	_, err := pool.Exec(t.Context(), `update app_user set updated_at='2026-10-28T01:02:03.123456Z' where id=$1`, first)
	require.NoError(t, err)
	input := user.BatchChangeGroupInput{Items: []user.BatchChangeGroupItem{{ID: first, ExpectedUpdatedAt: "2026-10-28T09:02:03.123456+08:00"}}, GroupKey: "user"}
	result, err := service.BatchChangeGroup(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 1, result.UnchangedCount)
	for _, at := range []string{"2026-10-28T01:02:03Z", "2026-10-28T01:02:03.123Z", "2026-10-28T01:02:03.123456001Z"} {
		input.Items[0].ExpectedUpdatedAt = at
		_, err = service.BatchChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrVersionConflict)
	}
	ids := []string{first}
	for i := 1; i < 100; i++ {
		ids = append(ids, insertAppUser(t, t.Context(), pool, fmt.Sprintf("batch-%03d", i), "", "Batch", "user", "active", false))
	}
	result, err = service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: batchItems(t, pool, ids...), GroupKey: "admin"})
	require.NoError(t, err)
	require.Equal(t, user.BatchChangeGroupResult{ChangedCount: 100}, result)
	var admins, audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where u.id=any($1::uuid[]) and g.key='admin'`, ids).Scan(&admins))
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_id=any($1::text[]) and changed_fields=array['group_id']`, ids).Scan(&audits))
	require.Equal(t, 100, admins)
	require.Equal(t, 100, audits)
}

// TestBatchChangeGroupErrorPriority catches per-item early returns whose outcome depends on request order.
func TestBatchChangeGroupErrorPriority(t *testing.T) {
	pool, service, actor, valid := groupFixture(t)
	builtin := insertAppUser(t, t.Context(), pool, "builtin", "", "Builtin", "user", "active", true)
	unsupported := insertAppUser(t, t.Context(), pool, "guest-member", "", "Guest", "guest", "active", false)
	deleted := insertAppUser(t, t.Context(), pool, "deleted", "", "Deleted", "user", "active", false)
	_, err := pool.Exec(t.Context(), `update app_user set deleted_at=now() where id=$1`, deleted)
	require.NoError(t, err)
	all := batchItems(t, pool, valid, builtin, actor.ID, unsupported, deleted)
	all[0].ExpectedUpdatedAt = "2020-01-01T00:00:00Z"
	missing := user.BatchChangeGroupItem{ID: uuid.NewString(), ExpectedUpdatedAt: all[0].ExpectedUpdatedAt}
	for _, tc := range []struct {
		items []user.BatchChangeGroupItem
		want  error
	}{
		{append(slices.Clone(all), missing), user.ErrUserNotFound},
		{all, user.ErrUserNotFound},
		{all[:4], user.ErrBuiltinUserImmutable},
		{[]user.BatchChangeGroupItem{all[0], all[2], all[3]}, user.ErrSelfGroupChange},
		{[]user.BatchChangeGroupItem{all[0], all[3]}, user.ErrInvalidInput},
		{all[:1], user.ErrVersionConflict},
	} {
		for range 2 {
			result, err := service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: tc.items, GroupKey: "admin"})
			require.ErrorIs(t, err, tc.want)
			require.Equal(t, user.BatchChangeGroupResult{}, result)
			slices.Reverse(tc.items)
		}
	}
	var group string
	require.NoError(t, pool.QueryRow(t.Context(), `select g.key from app_user u join user_group g on g.id=u.group_id where u.id=$1`, valid).Scan(&group))
	require.Equal(t, "user", group)
	var audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where changed_fields=array['group_id']`).Scan(&audits))
	require.Zero(t, audits)
}

// TestBatchChangeGroupAuthorization rejects stale or forged entry identities using locked current database state.
func TestBatchChangeGroupAuthorization(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	input := user.BatchChangeGroupInput{Items: batchItems(t, pool, id), GroupKey: "admin"}
	_, err := service.BatchChangeGroup(t.Context(), auth.CurrentUser{ID: uuid.NewString(), GroupKey: "admin"}, input)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = service.BatchChangeGroup(t.Context(), auth.CurrentUser{ID: id, GroupKey: "admin", Permissions: []string{"admin:access"}}, input)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	for _, statement := range []string{
		`update app_user set builtin=true where id=$1`,
		`update app_user set builtin=false,status='disabled' where id=$1`,
		`update app_user set status='active',deleted_at=now() where id=$1`,
		`update app_user set deleted_at=null,group_id=(select id from user_group where key='user') where id=$1`,
	} {
		_, err = pool.Exec(t.Context(), statement, actor.ID)
		require.NoError(t, err)
		_, err = service.BatchChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrPermissionDenied)
	}
	_, err = pool.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='admin') where id=$1`, actor.ID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]'::jsonb where key='admin'`)
	require.NoError(t, err)
	_, err = service.BatchChangeGroup(t.Context(), actor, input)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='{}'::jsonb where key='admin'`)
	require.NoError(t, err)
	_, err = service.BatchChangeGroup(t.Context(), actor, input)
	require.Error(t, err)
	require.NotErrorIs(t, err, user.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[1]'::jsonb where key='admin'`)
	require.NoError(t, err)
	_, err = service.BatchChangeGroup(t.Context(), actor, input)
	require.Error(t, err)
	require.NotErrorIs(t, err, user.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]'::jsonb where key='admin'`)
	require.NoError(t, err)
	for _, key := range []string{"admin", "user"} {
		_, err = pool.Exec(t.Context(), `update user_group set builtin=false where key=$1`, key)
		require.NoError(t, err)
		_, err = service.BatchChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrInvalidInput)
		_, err = pool.Exec(t.Context(), `update user_group set builtin=true where key=$1`, key)
		require.NoError(t, err)
	}
	for _, key := range []string{"admin", "user"} {
		_, err = pool.Exec(t.Context(), `update user_group set key=$2 where key=$1`, key, "formerly-"+key)
		require.NoError(t, err)
		_, err = service.BatchChangeGroup(t.Context(), actor, input)
		require.ErrorIs(t, err, user.ErrInvalidInput)
		_, err = pool.Exec(t.Context(), `update user_group set key=$2 where key=$1`, "formerly-"+key, key)
		require.NoError(t, err)
	}
}

// TestBatchChangeGroupNullPermissions rejects corrupt configuration without changing membership, sessions or audit.
func TestBatchChangeGroupNullPermissions(t *testing.T) {
	pool, service, actor, id := groupFixture(t)
	items := batchItems(t, pool, id)
	sessions := auth.NewSessionService(pool, time.Hour)
	old, err := sessions.Create(t.Context(), id)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='null'::jsonb where key='admin'`)
	require.NoError(t, err)
	result, err := service.BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: items, GroupKey: "admin"})
	require.Error(t, err)
	require.NotErrorIs(t, err, user.ErrPermissionDenied)
	require.NotErrorIs(t, err, user.ErrInvalidInput)
	require.Equal(t, user.BatchChangeGroupResult{}, result)
	require.Equal(t, items, batchItems(t, pool, id))
	var group string
	require.NoError(t, pool.QueryRow(t.Context(), `select g.key from app_user u join user_group g on g.id=u.group_id where u.id=$1`, id).Scan(&group))
	require.Equal(t, "user", group)
	_, err = sessions.Resolve(t.Context(), old.ID)
	require.NoError(t, err)
	var audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where resource_type='user' and action='update' and changed_fields=array['group_id']`).Scan(&audits))
	require.Zero(t, audits)
}

type batchFaultTracer struct {
	prefix           string
	occurrence, seen int
}

// TraceQueryStart cancels the selected real driver command, including the second member's side effects.
func (tr *batchFaultTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.HasPrefix(data.SQL, tr.prefix) {
		tr.seen++
		if tr.seen == tr.occurrence {
			ctx, cancel := context.WithCancel(ctx)
			cancel()
			return ctx
		}
	}
	return ctx
}

// TraceQueryEnd observes the real driver; no database operations are replaced by a mock.
func (*batchFaultTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestBatchChangeGroupRollback catches partial batches, premature counts and revoked sessions after any failure.
func TestBatchChangeGroupRollback(t *testing.T) {
	pool, _, actor, first := groupFixture(t)
	second := insertAppUser(t, t.Context(), pool, "second", "", "Second", "user", "active", false)
	items := batchItems(t, pool, first, second)
	sessions := auth.NewSessionService(pool, time.Hour)
	var tokens []string
	for _, id := range []string{first, second} {
		session, err := sessions.Create(t.Context(), id)
		require.NoError(t, err)
		tokens = append(tokens, session.ID)
	}
	for _, tc := range []struct {
		prefix string
		n      int
	}{
		{"begin", 1}, {"select set_config", 1}, {"-- name: LockGroupChangeUsers", 1},
		{"-- name: GetGroupChangeGroup", 1}, {"-- name: GetGroupChangeGroup", 2},
		{"-- name: ChangeAppUserGroup", 2}, {"-- name: RevokeGroupChangeSessions", 2}, {"commit", 1},
	} {
		t.Run(fmt.Sprintf("%s-%d", tc.prefix, tc.n), func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = &batchFaultTracer{prefix: tc.prefix, occurrence: tc.n}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(faulty.Close)
			result, err := user.NewService(faulty, permission.NewDatabaseService(faulty)).BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: items, GroupKey: "admin"})
			require.Error(t, err)
			require.Equal(t, user.BatchChangeGroupResult{}, result)
			require.Equal(t, items, batchItems(t, pool, first, second))
			for _, token := range tokens {
				identity, err := auth.NewService(pool, time.Hour).Me(t.Context(), token)
				require.NoError(t, err)
				require.Equal(t, "user", identity.GroupKey)
			}
			var audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where changed_fields=array['group_id']`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
	// Fail only the second UUID-ordered audit after the first update and revocation have executed.
	ids := []string{first, second}
	slices.Sort(ids)
	_, err := pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_second check(resource_id <> '%s') not valid`, ids[1]))
	require.NoError(t, err)
	result, err := user.NewService(pool, nil).BatchChangeGroup(t.Context(), actor, user.BatchChangeGroupInput{Items: items, GroupKey: "admin"})
	require.Error(t, err)
	require.Equal(t, user.BatchChangeGroupResult{}, result)
	require.Equal(t, items, batchItems(t, pool, first, second))
	for _, token := range tokens {
		_, err := sessions.Resolve(t.Context(), token)
		require.NoError(t, err)
	}
}
