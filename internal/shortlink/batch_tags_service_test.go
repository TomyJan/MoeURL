package shortlink_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// batchTagsFixture provides real links with preserved metadata, access settings and history.
func batchTagsFixture(t *testing.T, count int) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, shortlink.BatchTagsInput) {
	t.Helper()
	pool, service, admin, owner, _, transfer := batchTransferFixture(t, count)
	input := shortlink.BatchTagsInput{Operation: "add", Tags: []string{" B ", "C"}}
	for i, item := range transfer.Items {
		tags := []string{"A", "B"}
		if i > 0 {
			tags = []string{"B"}
		}
		_, err := pool.Exec(t.Context(), `update short_link set tags=$2 where id=$1`, item.ID, tags)
		require.NoError(t, err)
		input.Items = append(input.Items, shortlink.BatchTagItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt})
	}
	return pool, service, admin, owner, input
}

// batchTagsSnapshot captures every tag, version and audit row for rollback assertions.
func batchTagsSnapshot(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var snapshot string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('links',(select jsonb_agg(to_jsonb(s) order by id) from short_link s),'audit',(select jsonb_agg(to_jsonb(a) order by id) from audit_log a))::text`).Scan(&snapshot))
	return snapshot
}

// TestBatchTagsAtomicity catches writing any row before all versions, ownership and limits are checked.
func TestBatchTagsAtomicity(t *testing.T) {
	for _, kind := range []string{"stale", "truncated version", "noop stale", "missing", "deleted", "foreign", "overlimit", "audit failure"} {
		t.Run(kind, func(t *testing.T) {
			pool, service, admin, owner, input := batchTagsFixture(t, 2)
			if input.Items[0].ID > input.Items[1].ID {
				input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
			}
			want := shortlink.ErrTransferConflict
			switch kind {
			case "stale", "noop stale":
				input.Items[1].ExpectedUpdatedAt = "2026-10-23T00:00:00Z"
				if kind == "noop stale" {
					input.Operation = "replace"
					input.Tags = []string{"A", "B"}
					_, err := pool.Exec(t.Context(), `update short_link set tags=array['A','B'] where id=$1`, input.Items[1].ID)
					require.NoError(t, err)
				}
			case "truncated version":
				input.Items[1].ExpectedUpdatedAt = "2026-10-23T00:00:00.123Z"
			case "missing":
				input.Items[1].ID = uuid.NewString()
				want = shortlink.ErrShortLinkMissing
			case "deleted":
				_, err := pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, input.Items[1].ID)
				require.NoError(t, err)
				want = shortlink.ErrShortLinkMissing
			case "foreign":
				_, err := pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, input.Items[1].ID, admin.ID)
				require.NoError(t, err)
				want = shortlink.ErrShortLinkMissing
			case "overlimit":
				_, err := pool.Exec(t.Context(), `update short_link set tags=array['0','1','2','3','4','5','6','7','8','9'] where id=$1`, input.Items[1].ID)
				require.NoError(t, err)
				want = shortlink.ErrBatchTagsLimit
			case "audit failure":
				_, err := pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_tags_audit check(resource_id <> '%s') not valid`, input.Items[1].ID))
				require.NoError(t, err)
			}
			if kind != "audit failure" {
				// Any premature update would hit this constraint and mask the expected business error.
				_, err := pool.Exec(t.Context(), `alter table audit_log add constraint reject_early_tags_write check(false) not valid`)
				require.NoError(t, err)
			}
			before := batchTagsSnapshot(t, pool)
			result, err := service.BatchTags(t.Context(), owner, input)
			if kind == "audit failure" {
				require.Error(t, err)
			} else {
				require.ErrorIs(t, err, want)
			}
			require.Zero(t, result)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}

// TestBatchTagsAuthorization catches stale authorization snapshots and partial permission checks.
func TestBatchTagsAuthorization(t *testing.T) {
	for _, admin := range []bool{false, true} {
		for _, kind := range []string{"guest", "bad actor", "zero actor", "noncanonical actor", "missing actor", "disabled", "deleted", "guest group", "write revoked", "metadata revoked", "admin revoked", "invalid grants", "deadline", "database"} {
			if !admin && kind == "admin revoked" {
				continue
			}
			t.Run(fmt.Sprintf("admin=%t/%s", admin, kind), func(t *testing.T) {
				pool, _, manager, owner, input := batchTagsFixture(t, 2)
				actor := owner
				if admin {
					actor = manager
				}
				ctx := t.Context()
				want := shortlink.ErrPermissionDenied
				var err error
				switch kind {
				case "guest":
					actor = auth.GuestUser()
				case "bad actor":
					actor.ID = "bad"
				case "zero actor":
					actor.ID = uuid.Nil.String()
				case "noncanonical actor":
					actor.ID = "ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF"
				case "missing actor":
					actor.ID = uuid.NewString()
				case "disabled":
					_, err = pool.Exec(ctx, `update app_user set status='disabled' where id=$1`, actor.ID)
				case "deleted":
					_, err = pool.Exec(ctx, `update app_user set deleted_at=now() where id=$1`, actor.ID)
				case "guest group":
					_, err = pool.Exec(ctx, `update user_group set key='guest' where key=$1`, actor.GroupKey)
				case "write revoked":
					capability := permission.ShortLinkUpdateOwn
					if admin {
						capability = permission.ShortLinkUpdateAll
					}
					_, err = pool.Exec(ctx, `update user_group set permissions=permissions-$2::text where key=$1`, actor.GroupKey, capability)
				case "metadata revoked":
					_, err = pool.Exec(ctx, `update user_group set permissions=permissions-'short_link:set_metadata' where key=$1`, actor.GroupKey)
				case "admin revoked":
					_, err = pool.Exec(ctx, `update user_group set permissions=permissions-'admin:access' where key=$1`, actor.GroupKey)
				case "invalid grants":
					_, err = pool.Exec(ctx, `update user_group set permissions='{}' where key=$1`, actor.GroupKey)
					want = nil
				case "deadline":
					var cancel context.CancelFunc
					ctx, cancel = context.WithDeadline(ctx, time.Now().Add(-time.Second))
					defer cancel()
					want = nil
				case "database":
					_, err = pool.Exec(ctx, `alter table app_user rename to unavailable_app_user`)
					want = nil
				}
				require.NoError(t, err)
				before := batchTagsSnapshot(t, pool)
				svc := shortlink.NewService(pool, permission.NewService())
				var result shortlink.BatchTagsResult
				if admin {
					result, err = svc.AdminBatchTags(ctx, actor, input)
				} else {
					result, err = svc.BatchTags(ctx, actor, input)
				}
				if want == nil {
					require.Error(t, err)
				} else {
					require.ErrorIs(t, err, want)
				}
				require.Zero(t, result)
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
		for _, missing := range []string{permission.ShortLinkUpdateOwn, permission.ShortLinkSetMetadata, permission.AdminAccess, permission.ShortLinkUpdateAll} {
			if admin && missing == permission.ShortLinkUpdateOwn || !admin && (missing == permission.AdminAccess || missing == permission.ShortLinkUpdateAll) {
				continue
			}
			t.Run(fmt.Sprintf("entry/admin=%t/%s", admin, missing), func(t *testing.T) {
				pool, _, manager, owner, input := batchTagsFixture(t, 1)
				userPermissions := append([]string{}, permission.UserPermissions...)
				adminPermissions := append([]string{}, permission.AdminPermissions...)
				remove := func(values []string) []string {
					result := []string{}
					for _, value := range values {
						if value != missing {
							result = append(result, value)
						}
					}
					return result
				}
				svc := shortlink.NewService(pool, permission.NewServiceWithPermissions(remove(userPermissions), remove(adminPermissions)))
				var err error
				if admin {
					_, err = svc.AdminBatchTags(t.Context(), manager, input)
				} else {
					_, err = svc.BatchTags(t.Context(), owner, input)
				}
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			})
		}
	}
}

// TestBatchTagsDatabaseFailures preserves complete state when real driver boundaries fail.
func TestBatchTagsDatabaseFailures(t *testing.T) {
	pool, _, admin, _, input := batchTagsFixture(t, 2)
	before := batchTagsSnapshot(t, pool)
	for _, prefix := range []string{"begin", "select set_config", "-- name: LockBatchTagsActor", "-- name: LockTransferActorGroup", "-- name: LockBatchTagsShortLinks", "-- name: UpdateBatchTags", "commit"} {
		t.Run(prefix, func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = transferFaultTracer{prefix}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			defer faulty.Close()
			result, err := shortlink.NewService(faulty, permission.NewService()).AdminBatchTags(t.Context(), admin, input)
			require.Error(t, err)
			require.Zero(t, result)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
	// The entry resolver also propagates a real database failure without reaching any write.
	_, err := pool.Exec(t.Context(), `alter table user_group rename to unavailable_user_group`)
	require.NoError(t, err)
	_, err = shortlink.NewService(pool, permission.NewDatabaseService(pool)).AdminBatchTags(t.Context(), admin, input)
	require.Error(t, err)
}

type batchTagsIdentity struct{ actor auth.CurrentUser }

// ResolveCurrentUser supplies an authenticated boundary identity while retaining the real router and service.
func (r batchTagsIdentity) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.actor, nil
}

// TestBatchTagsRouterSuccess verifies both real endpoints persist their payload and return no-store counts.
func TestBatchTagsRouterSuccess(t *testing.T) {
	for _, admin := range []bool{false, true} {
		t.Run(fmt.Sprint(admin), func(t *testing.T) {
			pool, service, manager, owner, input := batchTagsFixture(t, 2)
			actor := owner
			path := "/api/v1/short-link/batch-tags"
			if admin {
				actor = manager
				path = "/api/v1/admin/short-link/batch-tags"
			}
			body, err := json.Marshal(input)
			require.NoError(t, err)
			router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatchTags: service, CurrentUser: batchTagsIdentity{actor}})
			r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(string(body)))
			r.Header.Set("Content-Type", "application/json")
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "tags-session"})
			w := httptest.NewRecorder()
			router.ServeHTTP(w, r)
			require.Equal(t, 200, w.Code)
			require.Contains(t, w.Body.String(), `"code":0`)
			require.Contains(t, w.Body.String(), `"changedCount":2,"unchangedCount":0`)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var tags []string
			require.NoError(t, pool.QueryRow(t.Context(), `select tags from short_link where id=$1`, input.Items[0].ID).Scan(&tags))
			require.Equal(t, []string{"A", "B", "C"}, tags)
		})
	}
}

// waitBatchTagsLock observes a real database lock wait rather than guessing from elapsed time.
func waitBatchTagsLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, query string, done <-chan error) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		require.NoError(t, pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1)`, query+"%").Scan(&waiting))
		if waiting {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("completed before required lock wait: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

// TestBatchTagsAuthorizationWait rechecks committed account and group changes after the entry snapshot.
func TestBatchTagsAuthorizationWait(t *testing.T) {
	for _, change := range []struct{ name, sql, query string }{
		{"disabled actor", `update app_user set status='disabled' where username='original'`, "-- name: LockBatchTagsActor"},
		{"changed group", `update app_user set group_id=(select id from user_group where key='guest') where username='original'`, "-- name: LockBatchTagsActor"},
		{"metadata revoked", `update user_group set permissions=permissions-'short_link:set_metadata' where key='user'`, "-- name: LockTransferActorGroup"},
		{"write revoked", `update user_group set permissions=permissions-'short_link:update_own' where key='user'`, "-- name: LockTransferActorGroup"},
	} {
		t.Run(change.name, func(t *testing.T) {
			pool, _, _, owner, input := batchTagsFixture(t, 2)
			_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'guest','Guest','[]',true,now(),now())`, uuid.NewString())
			require.NoError(t, err)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = tx.Rollback(context.Background()) }()
			_, err = tx.Exec(ctx, change.sql)
			require.NoError(t, err)
			before := batchTagsSnapshot(t, pool)
			done := make(chan error, 1)
			go func() {
				_, err := shortlink.NewService(pool, permission.NewService()).BatchTags(ctx, owner, input)
				done <- err
			}()
			waitBatchTagsLock(t, ctx, pool, change.query, done)
			require.NoError(t, tx.Commit(ctx))
			require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}

// TestBatchTagsConcurrency catches request-order locking and accidental exclusive actor locks.
func TestBatchTagsConcurrency(t *testing.T) {
	pool, _, admin, _, input := batchTagsFixture(t, 2)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	var pools []*pgxpool.Pool
	var blocker pgx.Tx
	var workers sync.WaitGroup
	defer func() {
		cancel()
		if blocker != nil {
			_ = blocker.Rollback(context.Background())
		}
		workers.Wait()
		for _, connection := range pools {
			connection.Close()
		}
	}()
	var pids [2]int32
	for i := range pids {
		config := pool.Config()
		config.MaxConns = 1
		connection, err := pgxpool.NewWithConfig(ctx, config)
		require.NoError(t, err)
		pools = append(pools, connection)
		require.NoError(t, connection.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pids[i]))
	}
	if input.Items[0].ID < input.Items[1].ID {
		input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
	}
	other := input
	other.Items = []shortlink.BatchTagItem{input.Items[1], input.Items[0]}
	other.Tags = []string{"D"}
	var err error
	blocker, err = pool.Begin(ctx)
	require.NoError(t, err)
	_, err = blocker.Exec(ctx, `select id from short_link where id=$1 for update`, input.Items[0].ID)
	require.NoError(t, err)
	type outcome struct {
		result shortlink.BatchTagsResult
		err    error
	}
	done := []chan outcome{make(chan outcome, 1), make(chan outcome, 1)}
	start := func(i int, request shortlink.BatchTagsInput) {
		workers.Go(func() {
			result, err := shortlink.NewService(pools[i], permission.NewService()).AdminBatchTags(ctx, admin, request)
			done[i] <- outcome{result, err}
		})
	}
	waitBlockedBy := func(i int, expected int32) {
		t.Helper()
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			var blockers []int32
			require.NoError(t, pool.QueryRow(ctx, `select pg_blocking_pids($1::integer)`, pids[i]).Scan(&blockers))
			if len(blockers) > 0 {
				require.Equal(t, []int32{expected}, blockers, "requests must wait on sorted links, not shared actor/group rows")
				return
			}
			select {
			case result := <-done[i]:
				t.Fatalf("batch %d completed before lock wait: %+v", i, result)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-ticker.C:
			}
		}
	}
	start(0, input)
	waitBlockedBy(0, int32(blocker.Conn().PgConn().PID()))
	start(1, other)
	waitBlockedBy(1, pids[0])
	require.NoError(t, blocker.Commit(ctx))
	winner, loser := <-done[0], <-done[1]
	require.NoError(t, winner.err)
	require.Equal(t, shortlink.BatchTagsResult{ChangedCount: 2}, winner.result)
	require.ErrorIs(t, loser.err, shortlink.ErrTransferConflict)
	require.Zero(t, loser.result)
	for _, item := range input.Items {
		var tags []string
		require.NoError(t, pool.QueryRow(ctx, `select tags from short_link where id=$1`, item.ID).Scan(&tags))
		require.Contains(t, tags, "C")
		require.NotContains(t, tags, "D")
	}
	var audits int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where changed_fields=array['tags']`).Scan(&audits))
	require.Equal(t, 2, audits)
}

// TestBatchTagsTagBounds catches off-by-one limits and replacement order being treated as a set.
func TestBatchTagsTagBounds(t *testing.T) {
	for _, operation := range []string{"add", "remove", "replace"} {
		for _, count := range []int{1, 10, 11} {
			t.Run(fmt.Sprintf("%s/%d", operation, count), func(t *testing.T) {
				pool, service, admin, _, input := batchTagsFixture(t, 1)
				_, err := pool.Exec(t.Context(), `update short_link set tags='{}'`)
				require.NoError(t, err)
				input.Operation = operation
				input.Tags = []string{}
				for i := 0; i < count; i++ {
					input.Tags = append(input.Tags, fmt.Sprint(i))
				}
				result, err := service.AdminBatchTags(t.Context(), admin, input)
				if count == 11 {
					require.ErrorIs(t, err, shortlink.ErrInvalidInput)
					require.Zero(t, result)
					return
				}
				require.NoError(t, err)
				want := shortlink.BatchTagsResult{ChangedCount: 1}
				if operation == "remove" {
					want = shortlink.BatchTagsResult{UnchangedCount: 1}
				}
				require.Equal(t, want, result)
				var tags []string
				require.NoError(t, pool.QueryRow(t.Context(), `select tags from short_link`).Scan(&tags))
				if operation == "remove" {
					require.Empty(t, tags)
				} else {
					require.Equal(t, input.Tags, tags)
				}
			})
		}
	}
	t.Run("replacement preserves request order", func(t *testing.T) {
		pool, service, admin, _, input := batchTagsFixture(t, 1)
		input.Operation, input.Tags = "replace", []string{"B", "A"}
		result, err := service.AdminBatchTags(t.Context(), admin, input)
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchTagsResult{ChangedCount: 1}, result)
		var tags []string
		require.NoError(t, pool.QueryRow(t.Context(), `select tags from short_link`).Scan(&tags))
		require.Equal(t, []string{"B", "A"}, tags)
	})
}

// TestBatchTagsOldOwnerWait refuses an old owner's pending batch after a handoff commits.
func TestBatchTagsOldOwnerWait(t *testing.T) {
	pool, service, admin, owner, input := batchTagsFixture(t, 2)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	barrier := batchCommitBarrier{make(chan struct{}), make(chan struct{})}
	var release sync.Once
	config := pool.Config()
	config.ConnConfig.Tracer = barrier
	blocked, err := pgxpool.NewWithConfig(ctx, config)
	require.NoError(t, err)
	defer blocked.Close()
	defer release.Do(func() { close(barrier.release) })
	transfer := shortlink.BatchTransferInput{NewOwnerUsername: "recipient"}
	for _, item := range input.Items {
		transfer.Items = append(transfer.Items, shortlink.BatchTransferItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt})
	}
	handoff := make(chan error, 1)
	go func() {
		_, err := shortlink.NewService(blocked, permission.NewService()).BatchTransfer(ctx, admin, transfer)
		handoff <- err
	}()
	select {
	case <-barrier.entered:
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	done := make(chan error, 1)
	go func() { _, err := service.BatchTags(ctx, owner, input); done <- err }()
	waitBatchTagsLock(t, ctx, pool, "-- name: LockBatchTagsShortLinks", done)
	release.Do(func() { close(barrier.release) })
	require.NoError(t, <-handoff)
	require.ErrorIs(t, <-done, shortlink.ErrShortLinkMissing)
	var audits int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where changed_fields=array['tags']`).Scan(&audits))
	require.Zero(t, audits)
	var tags []string
	require.NoError(t, pool.QueryRow(ctx, `select tags from short_link where id=$1`, input.Items[0].ID).Scan(&tags))
	require.Equal(t, []string{"A", "B"}, tags)
}

// TestBatchTagsOperations catches lost ordering, accidental duplicates and writes on no-ops.
func TestBatchTagsOperations(t *testing.T) {
	for _, operation := range []string{"add", "remove", "replace"} {
		t.Run(operation, func(t *testing.T) {
			pool, service, _, owner, input := batchTagsFixture(t, 2)
			input.Operation = operation
			want := [][]string{{"A", "B", "C"}, {"B", "C"}}
			if operation == "remove" {
				input.Tags = []string{"B", "missing"}
				want = [][]string{{"A"}, {}}
			}
			if operation == "replace" {
				input.Tags = []string{}
				want = [][]string{{}, {}}
			}
			_, err := pool.Exec(t.Context(), `insert into short_link_access_grant(id,short_link_id,token_hash,expires_at,created_at) values($1,$2,'tags-grant',now()+interval '15 minutes',now())`, uuid.NewString(), input.Items[0].ID)
			require.NoError(t, err)
			var before, after, grantsBefore, grantsAfter, eventsBefore, eventsAfter string
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'tags'-'updated_at' order by id)::text from short_link s`).Scan(&before))
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(g))::text from short_link_access_grant g`).Scan(&grantsBefore))
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(e))::text from short_link_event e`).Scan(&eventsBefore))
			result, err := service.BatchTags(t.Context(), owner, input)
			require.NoError(t, err)
			require.Equal(t, shortlink.BatchTagsResult{ChangedCount: 2}, result)
			for i, item := range input.Items {
				var tags []string
				var version time.Time
				require.NoError(t, pool.QueryRow(t.Context(), `select tags,updated_at from short_link where id=$1`, item.ID).Scan(&tags, &version))
				require.Equal(t, want[i], tags)
				require.NotEqual(t, item.ExpectedUpdatedAt, version.UTC().Format(time.RFC3339Nano))
				input.Items[i].ExpectedUpdatedAt = version.UTC().Format(time.RFC3339Nano)
			}
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'tags'-'updated_at' order by id)::text from short_link s`).Scan(&after))
			require.JSONEq(t, before, after)
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(g))::text from short_link_access_grant g`).Scan(&grantsAfter))
			require.JSONEq(t, grantsBefore, grantsAfter)
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(e))::text from short_link_event e`).Scan(&eventsAfter))
			require.JSONEq(t, eventsBefore, eventsAfter)
			result, err = service.BatchTags(t.Context(), owner, input)
			require.NoError(t, err)
			require.Equal(t, shortlink.BatchTagsResult{UnchangedCount: 2}, result)
			var audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['tags']`, owner.ID).Scan(&audits))
			require.Equal(t, 2, audits)
			for _, item := range input.Items {
				var version time.Time
				require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, item.ID).Scan(&version))
				require.Equal(t, item.ExpectedUpdatedAt, version.UTC().Format(time.RFC3339Nano))
			}
		})
	}
	t.Run("mixed no-op and monotonic future version", func(t *testing.T) {
		pool, service, admin, _, input := batchTagsFixture(t, 2)
		input.Operation, input.Tags = "replace", []string{"B"}
		_, err := pool.Exec(t.Context(), `update short_link set updated_at='2099-01-01T00:00:00.123456Z'`)
		require.NoError(t, err)
		for i := range input.Items {
			input.Items[i].ExpectedUpdatedAt = "2099-01-01T00:00:00.123456Z"
		}
		result, err := service.AdminBatchTags(t.Context(), admin, input)
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchTagsResult{ChangedCount: 1, UnchangedCount: 1}, result)
		var version time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, input.Items[0].ID).Scan(&version))
		require.Equal(t, "2099-01-01T00:00:00.123457Z", version.UTC().Format(time.RFC3339Nano))
	})
}

// TestBatchTagsGuards catches ambiguous identifiers, absent arrays and invalid normalized tags.
func TestBatchTagsGuards(t *testing.T) {
	_, service, _, owner, input := batchTagsFixture(t, 2)
	for i, mutate := range []func(*shortlink.BatchTagsInput){
		func(v *shortlink.BatchTagsInput) { v.Items = nil },
		func(v *shortlink.BatchTagsInput) { v.Items = make([]shortlink.BatchTagItem, 101) },
		func(v *shortlink.BatchTagsInput) { v.Items[1] = v.Items[0] },
		func(v *shortlink.BatchTagsInput) { v.Items[0].ID = "bad" },
		func(v *shortlink.BatchTagsInput) { v.Items[0].ID = uuid.Nil.String() },
		func(v *shortlink.BatchTagsInput) { v.Items[0].ID = "ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF" },
		func(v *shortlink.BatchTagsInput) { v.Items[0].ExpectedUpdatedAt = "bad" },
		func(v *shortlink.BatchTagsInput) { v.Items[0].ExpectedUpdatedAt = "0001-01-01T00:00:00Z" },
		func(v *shortlink.BatchTagsInput) { v.Operation = "" },
		func(v *shortlink.BatchTagsInput) { v.Operation = "ADD" },
		func(v *shortlink.BatchTagsInput) { v.Tags = nil },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{} },
		func(v *shortlink.BatchTagsInput) { v.Operation = "remove"; v.Tags = []string{} },
		func(v *shortlink.BatchTagsInput) { v.Tags = make([]string, 11) },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{"\u2003"} },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{"A", " A "} },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{"A\x00"} },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{strings.Repeat("中", 33)} },
		func(v *shortlink.BatchTagsInput) { v.Tags = []string{string([]byte{0xff})} },
	} {
		t.Run(fmt.Sprint(i), func(t *testing.T) {
			bad := input
			bad.Items = append([]shortlink.BatchTagItem{}, input.Items...)
			mutate(&bad)
			_, err := service.BatchTags(t.Context(), owner, bad)
			require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		})
	}
	for _, count := range []int{1, 100} {
		t.Run(fmt.Sprintf("accepted-%d", count), func(t *testing.T) {
			_, svc, admin, _, valid := batchTagsFixture(t, count)
			valid.Tags = []string{"\u2003" + strings.Repeat("中", 32) + " ", "a", "A", "e\u0301", "é"}
			result, err := svc.AdminBatchTags(t.Context(), admin, valid)
			require.NoError(t, err)
			require.Equal(t, shortlink.BatchTagsResult{ChangedCount: count}, result)
		})
	}
}
