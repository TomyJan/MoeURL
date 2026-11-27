package permission_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

type permissionResolution struct {
	snapshot permission.Snapshot
	err      error
}

func TestDatabaseServiceResolvesCurrentAccountPermissionUnion(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	primaryID, supplementalID, secondSupplementalID, userID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','["short_link:create","short_link:read_own"]',true,now(),now())`, primaryID)
	require.NoError(t, err)
	firstSupplementalKey := "550e8400-e29b-41d4-a716-446655440001"
	secondSupplementalKey := "550e8400-e29b-41d4-a716-446655440002"
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Supplemental','["short_link:read_own","short_link:set_metadata"]',false,now(),now())`, supplementalID, uuid.NewString())
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set key=$2 where id=$1`, supplementalID, firstSupplementalKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Second supplemental','["short_link:set_metadata","short_link:set_expiration"]',false,now(),now())`, secondSupplementalID, secondSupplementalKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Permission Union',$3,'active',false,now(),now())`, userID, "permission-union-"+userID.String(), primaryID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, userID, supplementalID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, userID, secondSupplementalID)
	require.NoError(t, err)

	resolver := permission.NewDatabaseService(pool)
	snapshot, err := resolver.ResolveAccount(t.Context(), userID.String())
	require.NoError(t, err)
	require.True(t, snapshot.Has(permission.ShortLinkCreate))
	require.True(t, snapshot.Has(permission.ShortLinkSetMetadata))
	require.True(t, snapshot.Has(permission.ShortLinkSetExpiration))
	require.True(t, snapshot.Has(permission.ShortLinkReadOwn))
	require.False(t, snapshot.Has(permission.AdminAccess))
	keys := snapshot.GroupKeys()
	require.Equal(t, []string{firstSupplementalKey, secondSupplementalKey, permission.GroupUser}, keys)
	keys[0] = "mutated"
	require.Equal(t, []string{firstSupplementalKey, secondSupplementalKey, permission.GroupUser}, snapshot.GroupKeys())
	_, err = pool.Exec(t.Context(), `delete from app_user_group_membership where user_id=$1`, userID)
	require.NoError(t, err)
	require.True(t, snapshot.Has(permission.ShortLinkSetMetadata))
	current, err := resolver.ResolveAccount(t.Context(), userID.String())
	require.NoError(t, err)
	require.False(t, current.Has(permission.ShortLinkSetMetadata))
	require.False(t, current.Has(permission.ShortLinkSetExpiration))
}

func TestDatabaseServiceResolvesPrimaryOnlyAndLockedSnapshots(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	groupID, userID := uuid.New(), uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','["short_link:create"]',true,now(),now())`, groupID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Primary only',$3,'active',false,now(),now())`, userID, "primary-only-"+userID.String(), groupID)
	require.NoError(t, err)
	resolver := permission.NewDatabaseService(pool)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer tx.Rollback(t.Context())
	snapshot, err := resolver.ResolveAccountLockedIn(t.Context(), tx, userID.String())
	require.NoError(t, err)
	require.True(t, snapshot.Has(permission.ShortLinkCreate))
	require.Equal(t, []string{permission.GroupUser}, snapshot.GroupKeys())
}

func TestDatabaseServiceLockedResolutionWaitsForPrimaryGroupReplacement(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	primaryID, replacementID, userID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','["short_link:create"]',true,now(),now())`, primaryID)
	require.NoError(t, err)
	replacementKey := "550e8400-e29b-41d4-a716-446655440099"
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Replacement','[]',false,now(),now())`, replacementID, replacementKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Lock race',$3,'active',false,now(),now())`, userID, "primary-lock-"+userID.String(), primaryID)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	blocker, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer blocker.Rollback(context.Background())
	_, err = blocker.Exec(ctx, `update app_user set group_id=$2 where id=$1`, userID, replacementID)
	require.NoError(t, err)
	var blockerPID int32
	require.NoError(t, blocker.QueryRow(ctx, `select pg_backend_pid()`).Scan(&blockerPID))

	reader, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer reader.Rollback(context.Background())
	var readerPID int32
	require.NoError(t, reader.QueryRow(ctx, `select pg_backend_pid()`).Scan(&readerPID))
	done := make(chan permissionResolution, 1)
	go func() {
		snapshot, resolveErr := permission.NewDatabaseService(pool).ResolveAccountLockedIn(ctx, reader, userID.String())
		done <- permissionResolution{snapshot: snapshot, err: resolveErr}
	}()
	waitForPermissionAccountLock(t, ctx, pool, readerPID, blockerPID, done)

	require.NoError(t, blocker.Commit(ctx))
	select {
	case result := <-done:
		require.NoError(t, result.err)
		require.False(t, result.snapshot.Has(permission.ShortLinkCreate), "resolution must observe the committed replacement primary group")
		require.Equal(t, []string{replacementKey}, result.snapshot.GroupKeys())
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

func TestDatabaseServiceLockedResolutionWaitsBeforeCountingSupplementalMemberships(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	primaryID, supplementalID, userID := uuid.New(), uuid.New(), uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','["short_link:create"]',true,now(),now())`, primaryID)
	require.NoError(t, err)
	supplementalKey := uuid.NewString()
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Supplemental','["short_link:set_metadata"]',false,now(),now())`, supplementalID, supplementalKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Membership lock',$3,'active',false,now(),now())`, userID, "membership-lock-"+userID.String(), primaryID)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	blocker, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer blocker.Rollback(context.Background())
	_, err = blocker.Exec(ctx, `select id from app_user where id=$1 for update`, userID)
	require.NoError(t, err)
	_, err = blocker.Exec(ctx, `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, userID, supplementalID)
	require.NoError(t, err)
	var blockerPID int32
	require.NoError(t, blocker.QueryRow(ctx, `select pg_backend_pid()`).Scan(&blockerPID))

	reader, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer reader.Rollback(context.Background())
	var readerPID int32
	require.NoError(t, reader.QueryRow(ctx, `select pg_backend_pid()`).Scan(&readerPID))
	done := make(chan permissionResolution, 1)
	go func() {
		snapshot, resolveErr := permission.NewDatabaseService(pool).ResolveAccountLockedIn(ctx, reader, userID.String())
		done <- permissionResolution{snapshot: snapshot, err: resolveErr}
	}()
	waitForPermissionAccountLock(t, ctx, pool, readerPID, blockerPID, done)

	require.NoError(t, blocker.Commit(ctx))
	select {
	case result := <-done:
		require.NoError(t, result.err)
		require.True(t, result.snapshot.Has(permission.ShortLinkSetMetadata))
		require.Equal(t, []string{supplementalKey, permission.GroupUser}, result.snapshot.GroupKeys())
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
}

// waitForPermissionAccountLock observes PostgreSQL's blocker graph instead of assuming goroutine order.
func waitForPermissionAccountLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid, blocker int32, done <-chan permissionResolution) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blockers []int32
		require.NoError(t, pool.QueryRow(ctx, `select pg_blocking_pids($1::integer)`, pid).Scan(&blockers))
		if slices.Contains(blockers, blocker) {
			return
		}
		select {
		case result := <-done:
			t.Fatalf("permission resolution completed before waiting for the account row lock: %v", result.err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

func TestDatabaseServiceFailsClosedWhenAccountPermissionReadFails(t *testing.T) {
	resolver := permission.NewDatabaseService(nil)
	if _, err := resolver.ResolveAccount(t.Context(), uuid.NewString()); err == nil {
		t.Fatal("a missing permission database returned a snapshot")
	}
	if _, err := resolver.ResolveAccountIn(t.Context(), nil, uuid.NewString()); err == nil {
		t.Fatal("a nil transaction returned an account snapshot")
	}
	if _, err := resolver.ResolveAccountLockedIn(t.Context(), nil, uuid.NewString()); err == nil {
		t.Fatal("a nil locked transaction returned an account snapshot")
	}
	if _, err := resolver.ResolveIn(t.Context(), nil, permission.GroupUser); err == nil {
		t.Fatal("a nil group transaction returned a snapshot")
	}
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	resolver = permission.NewDatabaseService(pool)
	if _, err := resolver.ResolveAccount(t.Context(), "not-a-uuid"); err == nil {
		t.Fatal("an invalid persisted account ID returned a snapshot")
	}
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	snapshot, err := resolver.ResolveAccount(canceled, uuid.NewString())
	require.Error(t, err)
	require.False(t, snapshot.Has(permission.ShortLinkCreate))
	if _, err := resolver.ResolveAccountLockedIn(canceled, pool, uuid.NewString()); err == nil {
		t.Fatal("a failed locked permission read returned a snapshot")
	}
	if _, err := resolver.ResolveAccountLockedIn(t.Context(), pool, "not-a-uuid"); err == nil {
		t.Fatal("a noncanonical account ID returned a snapshot")
	}
}

func TestDatabaseServiceRejectsMalformedAccountRowsAndReadErrors(t *testing.T) {
	resolver := permission.NewDatabaseService(nil)
	if _, err := resolver.ResolveAccount(context.Background(), "not-a-uuid"); err == nil {
		t.Fatal("invalid account ID returned a snapshot")
	}
	if _, err := permission.NewDatabaseService(nil).Resolve(context.Background(), permission.GroupUser); err == nil {
		t.Fatal("nil database group resolution returned a snapshot")
	}

	queryErr := errors.New("permission query failed")
	for _, test := range []struct {
		name string
		db   scriptedPermissionDB
	}{
		{name: "query error", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) { return nil, queryErr }}},
		{name: "row scan error", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{}}, scanErr: queryErr}, nil
		}}},
		{name: "rows iteration error", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{err: queryErr}, nil
		}}},
		{name: "missing account primary group", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, nil, nil, nil, false, nil, nil, nil}}}, nil
		}}},
		{name: "corrupt primary permissions", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, permission.GroupUser, true, []byte(`{}`), false, nil, nil, nil}}}, nil
		}}},
		{name: "invalid primary custom key", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, "not-a-uuid", false, []byte(`[]`), false, nil, nil, nil}}}, nil
		}}},
		{name: "missing supplemental group", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, permission.GroupUser, true, []byte(`[]`), true, nil, nil, nil}}}, nil
		}}},
		{name: "invalid supplemental reserved group", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, permission.GroupUser, true, []byte(`[]`), true, permission.GroupUser, false, []byte(`[]`)}}}, nil
		}}},
		{name: "invalid supplemental key", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, permission.GroupUser, true, []byte(`[]`), true, "not-a-uuid", false, []byte(`[]`)}}}, nil
		}}},
		{name: "corrupt supplemental permissions", db: scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
			return &scriptedPermissionRows{values: [][]any{{"active", false, false, permission.GroupUser, true, []byte(`[]`), true, "550e8400-e29b-41d4-a716-446655440009", false, []byte(`{"permissions":true}`)}}}, nil
		}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			service := &permission.DatabaseService{}
			_, err := service.ResolveAccountIn(t.Context(), test.db, uuid.NewString())
			require.Error(t, err)
		})
	}

	service := &permission.DatabaseService{}
	empty, err := service.ResolveAccountIn(t.Context(), scriptedPermissionDB{query: func(context.Context, string, ...any) (pgx.Rows, error) {
		return &scriptedPermissionRows{}, nil
	}}, uuid.NewString())
	require.NoError(t, err)
	require.False(t, empty.Has(permission.ShortLinkCreate))
}

func TestDatabaseServiceLockedResolutionPropagatesDatabaseFailures(t *testing.T) {
	readErr := errors.New("locked permission read failed")
	rowFailure := scriptedPermissionRow{err: readErr}
	countRow := func(count int) func(context.Context, string, ...any) pgx.Row {
		return func(_ context.Context, sql string, _ ...any) pgx.Row {
			if strings.Contains(sql, "select id from app_user") {
				return scriptedPermissionRow{values: []any{uuid.New()}}
			}
			return scriptedPermissionRow{values: []any{count}}
		}
	}
	for _, test := range []struct {
		name string
		db   scriptedPermissionDB
	}{
		{name: "account lock failure", db: scriptedPermissionDB{row: func(context.Context, string, ...any) pgx.Row { return rowFailure }}},
		{name: "count query failure", db: scriptedPermissionDB{row: func(_ context.Context, sql string, _ ...any) pgx.Row {
			if strings.Contains(sql, "select id from app_user") {
				return scriptedPermissionRow{values: []any{uuid.New()}}
			}
			return rowFailure
		}}},
		{name: "group lock query failure", db: scriptedPermissionDB{
			row: countRow(1),
			query: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
				if strings.Contains(sql, "select g.id") {
					return nil, readErr
				}
				return &scriptedPermissionRows{}, nil
			},
		}},
		{name: "group lock row scan failure", db: scriptedPermissionDB{
			row: countRow(1),
			query: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
				if strings.Contains(sql, "select g.id") {
					return &scriptedPermissionRows{values: [][]any{{}}, scanErr: readErr}, nil
				}
				return &scriptedPermissionRows{}, nil
			},
		}},
		{name: "group lock row iteration failure", db: scriptedPermissionDB{
			row: countRow(0),
			query: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
				if strings.Contains(sql, "select g.id") {
					return &scriptedPermissionRows{err: readErr}, nil
				}
				return &scriptedPermissionRows{}, nil
			},
		}},
		{name: "missing locked group", db: scriptedPermissionDB{
			row: countRow(1),
			query: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
				if strings.Contains(sql, "select g.id") {
					return &scriptedPermissionRows{}, nil
				}
				return &scriptedPermissionRows{}, nil
			},
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := (&permission.DatabaseService{}).ResolveAccountLockedIn(t.Context(), test.db, uuid.NewString())
			if test.name == "missing locked group" {
				require.ErrorContains(t, err, "one or more account groups are missing")
			} else {
				require.ErrorIs(t, err, readErr)
			}
		})
	}

	var queryCount int
	db := scriptedPermissionDB{
		row: func(_ context.Context, sql string, _ ...any) pgx.Row {
			if strings.Contains(sql, "select id from app_user") {
				return scriptedPermissionRow{values: []any{uuid.New()}}
			}
			return scriptedPermissionRow{values: []any{1}}
		},
		query: func(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
			if strings.Contains(sql, "select g.id") {
				return &scriptedPermissionRows{values: [][]any{{uuid.New()}}}, nil
			}
			queryCount++
			return &scriptedPermissionRows{}, nil
		},
	}
	_, err := (&permission.DatabaseService{}).ResolveAccountLockedIn(t.Context(), db, uuid.NewString())
	require.NoError(t, err)
	require.Equal(t, 1, queryCount, "the account snapshot is read only after every group lock succeeds")
}

func TestDatabaseServiceFailsClosedForInvalidAccountPermissionState(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	primaryID, supplementalID := uuid.New(), uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','["short_link:create"]',true,now(),now())`, primaryID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Supplemental','["short_link:create"]',false,now(),now())`, supplementalID, uuid.NewString())
	require.NoError(t, err)
	resolver := permission.NewDatabaseService(pool)
	for _, test := range []struct {
		name    string
		status  string
		deleted bool
		builtin bool
	}{
		{name: "missing account"},
		{name: "disabled account", status: "disabled"},
		{name: "deleted account", status: "active", deleted: true},
		{name: "builtin account", status: "active", builtin: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			id := uuid.New()
			if test.status != "" {
				_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,deleted_at,created_at,updated_at) values($1,$2,'Invalid',$3,$4,$5,case when $6 then now() end,now(),now())`, id, "invalid-"+id.String(), primaryID, test.status, test.builtin, test.deleted)
				require.NoError(t, err)
			}
			snapshot, err := resolver.ResolveAccount(t.Context(), id.String())
			require.NoError(t, err)
			require.False(t, snapshot.Has(permission.ShortLinkCreate))
		})
	}

	t.Run("malformed supplemental permission JSON", func(t *testing.T) {
		id := uuid.New()
		_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Malformed',$3,'active',false,now(),now())`, id, "malformed-"+id.String(), primaryID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, id, supplementalID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `update user_group set permissions='{"not":"an array"}'::jsonb where id=$1`, supplementalID)
		require.NoError(t, err)
		_, err = resolver.ResolveAccount(t.Context(), id.String())
		require.Error(t, err)
	})

	t.Run("missing supplemental group", func(t *testing.T) {
		id := uuid.New()
		_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Broken',$3,'active',false,now(),now())`, id, "missing-group-"+id.String(), primaryID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `alter table app_user_group_membership drop constraint app_user_group_membership_user_group_id_fkey`)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, _ = pool.Exec(t.Context(), `alter table app_user_group_membership add constraint app_user_group_membership_user_group_id_fkey foreign key(user_group_id) references user_group(id)`)
		})
		_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, id, uuid.New())
		require.NoError(t, err)
		_, err = resolver.ResolveAccount(t.Context(), id.String())
		require.Error(t, err)
	})

	t.Run("protected supplemental permission", func(t *testing.T) {
		id := uuid.New()
		_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Protected',$3,'active',false,now(),now())`, id, "protected-"+id.String(), primaryID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]'::jsonb where id=$1`, supplementalID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, id, supplementalID)
		require.NoError(t, err)
		_, err = resolver.ResolveAccount(t.Context(), id.String())
		require.Error(t, err)
	})

	t.Run("canceled context fails closed", func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		snapshot, err := resolver.ResolveAccount(ctx, uuid.NewString())
		require.Error(t, err)
		require.False(t, snapshot.Has(permission.ShortLinkCreate))
	})
}
