package shortlink_test

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func tagRenameFixture(t *testing.T, count int) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, shortlink.BatchTagRenameInput) {
	t.Helper()
	pool, svc, admin, owner, tags := batchTagsFixture(t, count)
	return pool, svc, admin, owner, shortlink.BatchTagRenameInput{Items: tags.Items, FromTag: "B", ToTag: "C"}
}

// TestBatchTagRenamePreservesData catches metadata loss, incorrect audit actors and unnecessary no-op writes.
func TestBatchTagRenamePreservesData(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, count := range []int{3, 100} {
			t.Run(fmt.Sprintf("admin=%t/count=%d", adminScope, count), func(t *testing.T) {
				pool, svc, admin, owner, input := tagRenameFixture(t, count)
				actor := owner
				if adminScope {
					actor = admin
				}
				_, err := pool.Exec(t.Context(), `update short_link set note='private-unchanged',tags=case when id=$1::uuid then array['B','A','C'] when id=$2::uuid then array['A','C'] else array['B','A'] end,updated_at='2099-01-01T00:00:00.123456Z'`, input.Items[0].ID, input.Items[1].ID)
				require.NoError(t, err)
				for i := range input.Items {
					input.Items[i].ExpectedUpdatedAt = "2099-01-01T00:00:00.123456Z"
				}
				var before, after string
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'tags'-'updated_at' order by id)::text from short_link s`).Scan(&before))
				var result shortlink.BatchTagsResult
				if adminScope {
					result, err = svc.RenameAdminTags(t.Context(), actor, input)
				} else {
					result, err = svc.RenameOwnTags(t.Context(), actor, input)
				}
				require.NoError(t, err)
				require.Equal(t, shortlink.BatchTagsResult{ChangedCount: count - 1, UnchangedCount: 1}, result)
				for i, item := range input.Items {
					var tags []string
					var version time.Time
					require.NoError(t, pool.QueryRow(t.Context(), `select tags,updated_at from short_link where id=$1`, item.ID).Scan(&tags, &version))
					want := []string{"C", "A"}
					if i < 2 {
						want = []string{"A", "C"}
					}
					require.Equal(t, want, tags)
					if i == 1 {
						require.Equal(t, "2099-01-01T00:00:00.123456Z", version.UTC().Format(time.RFC3339Nano))
					} else {
						require.Equal(t, "2099-01-01T00:00:00.123457Z", version.UTC().Format(time.RFC3339Nano))
					}
					input.Items[i].ExpectedUpdatedAt = version.UTC().Format(time.RFC3339Nano)
				}
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'tags'-'updated_at' order by id)::text from short_link s`).Scan(&after))
				require.JSONEq(t, before, after)
				var audits int
				require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['tags']`, actor.ID).Scan(&audits))
				require.Equal(t, count-1, audits)
				before = batchTagsSnapshot(t, pool)
				result, err = svc.RenameAdminTags(t.Context(), admin, input)
				require.NoError(t, err)
				require.Equal(t, shortlink.BatchTagsResult{UnchangedCount: count}, result)
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
	}
}

// TestBatchTagRenameAtomicity catches writes before validating later conflicts and audit failures.
func TestBatchTagRenameAtomicity(t *testing.T) {
	for _, kind := range []string{"stale", "noop stale", "missing", "deleted", "foreign", "audit failure"} {
		t.Run(kind, func(t *testing.T) {
			pool, svc, admin, owner, input := tagRenameFixture(t, 2)
			if input.Items[0].ID > input.Items[1].ID {
				input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
			}
			want := shortlink.ErrTransferConflict
			switch kind {
			case "stale", "noop stale":
				input.Items[1].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
				if kind == "noop stale" {
					_, err := pool.Exec(t.Context(), `update short_link set tags=array['C'] where id=$1`, input.Items[1].ID)
					require.NoError(t, err)
				}
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
			case "audit failure":
				_, err := pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_rename_audit check(resource_id <> '%s') not valid`, input.Items[1].ID))
				require.NoError(t, err)
			}
			if kind != "audit failure" {
				_, err := pool.Exec(t.Context(), `alter table audit_log add constraint reject_early_rename check(false) not valid`)
				require.NoError(t, err)
			}
			before := batchTagsSnapshot(t, pool)
			result, err := svc.RenameOwnTags(t.Context(), owner, input)
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

// TestBatchTagRenameReadIsNotWritePermission prevents accidentally inheriting the private-note read gate.
func TestBatchTagRenameReadIsNotWritePermission(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		t.Run(fmt.Sprint(adminScope), func(t *testing.T) {
			pool, svc, admin, owner, input := tagRenameFixture(t, 1)
			actor := owner
			capability := permission.ShortLinkReadOwn
			if adminScope {
				actor = admin
				capability = permission.ShortLinkReadAll
			}
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$2::text where key=$1`, actor.GroupKey, capability)
			require.NoError(t, err)
			if adminScope {
				_, err = svc.RenameAdminTags(t.Context(), actor, input)
			} else {
				_, err = svc.RenameOwnTags(t.Context(), actor, input)
			}
			require.NoError(t, err)
		})
	}
}

// TestBatchTagRenameDatabaseFailures catches swallowed errors and partial transactions at real driver boundaries.
func TestBatchTagRenameDatabaseFailures(t *testing.T) {
	pool, _, admin, _, input := tagRenameFixture(t, 2)
	before := batchTagsSnapshot(t, pool)
	for _, prefix := range []string{"begin", "select set_config", "-- name: LockBatchTagsActor", "-- name: LockTransferActorGroup", "-- name: LockBatchTagsShortLinks", "-- name: UpdateBatchTags", "commit"} {
		t.Run(prefix, func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = transferFaultTracer{prefix}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			defer faulty.Close()
			result, err := shortlink.NewService(faulty, permission.NewService()).RenameAdminTags(t.Context(), admin, input)
			require.Error(t, err)
			require.Zero(t, result)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}

// TestBatchTagRenameQueuedAuthorization observes lock waits before committing each authorization change.
func TestBatchTagRenameQueuedAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, kind := range []string{"disabled", "group", "write", "metadata", "admin"} {
			if !adminScope && kind == "admin" {
				continue
			}
			t.Run(fmt.Sprintf("admin=%t/%s", adminScope, kind), func(t *testing.T) {
				pool, _, admin, owner, input := tagRenameFixture(t, 2)
				if kind == "group" {
					_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'guest','Guest','[]',true,now(),now())`, uuid.NewString())
					require.NoError(t, err)
				}
				actor := owner
				if adminScope {
					actor = admin
				}
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				tx, err := pool.Begin(ctx)
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, tx.Rollback) }()
				query := "-- name: LockTransferActorGroup"
				switch kind {
				case "disabled":
					_, err = tx.Exec(ctx, `update app_user set status='disabled' where id=$1`, actor.ID)
					query = "-- name: LockBatchTagsActor"
				case "group":
					_, err = tx.Exec(ctx, `update app_user set group_id=(select id from user_group where key='guest') where id=$1`, actor.ID)
					query = "-- name: LockBatchTagsActor"
				default:
					capability := permission.ShortLinkSetMetadata
					if kind == "write" {
						capability = permission.ShortLinkUpdateOwn
						if adminScope {
							capability = permission.ShortLinkUpdateAll
						}
					}
					if kind == "admin" {
						capability = permission.AdminAccess
					}
					_, err = tx.Exec(ctx, `update user_group set permissions=permissions-$2::text where key=$1`, actor.GroupKey, capability)
				}
				require.NoError(t, err)
				before := batchTagsSnapshot(t, pool)
				done := make(chan error, 1)
				go func() {
					svc := shortlink.NewService(pool, permission.NewService())
					var err error
					if adminScope {
						_, err = svc.RenameAdminTags(ctx, actor, input)
					} else {
						_, err = svc.RenameOwnTags(ctx, actor, input)
					}
					done <- err
				}()
				waitBatchTagsLock(t, ctx, pool, query, done)
				require.NoError(t, tx.Commit(ctx))
				require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
	}
}

// TestBatchTagRenameQueuedResourceChanges rejects a pending old selection after handoff or editing.
func TestBatchTagRenameQueuedResourceChanges(t *testing.T) {
	for _, kind := range []string{"transfer", "edit", "cancel"} {
		t.Run(kind, func(t *testing.T) {
			pool, svc, admin, owner, input := tagRenameFixture(t, 2)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, tx.Rollback) }()
			_, err = tx.Exec(ctx, `select id from short_link order by id for update`)
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() { _, err := svc.RenameOwnTags(ctx, owner, input); done <- err }()
			waitBatchTagsLock(t, ctx, pool, "-- name: LockBatchTagsShortLinks", done)
			if kind == "cancel" {
				before := batchTagsSnapshot(t, pool)
				cancel()
				require.Error(t, <-done)
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
				return
			}
			want := shortlink.ErrTransferConflict
			if kind == "transfer" {
				_, err = tx.Exec(ctx, `update short_link set owner_id=$2,updated_at=updated_at+interval '1 microsecond' where id=$1`, input.Items[1].ID, admin.ID)
				want = shortlink.ErrShortLinkMissing
			} else {
				_, err = tx.Exec(ctx, `update short_link set tags=array['newer'],updated_at=updated_at+interval '1 microsecond' where id=$1`, input.Items[1].ID)
			}
			require.NoError(t, err)
			require.NoError(t, tx.Commit(ctx))
			before := batchTagsSnapshot(t, pool)
			require.ErrorIs(t, <-done, want)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}

// TestBatchTagRenameConcurrency catches request-order locks and a second writer silently using stale versions.
func TestBatchTagRenameConcurrency(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		t.Run(fmt.Sprint(adminScope), func(t *testing.T) {
			pool, _, admin, owner, input := tagRenameFixture(t, 2)
			actor := owner
			if adminScope {
				actor = admin
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			var connections []*pgxpool.Pool
			var blocker pgx.Tx
			var workers sync.WaitGroup
			defer func() {
				cancel()
				if blocker != nil {
					testdb.Rollback(t, blocker.Rollback)
				}
				workers.Wait()
				for _, connection := range connections {
					connection.Close()
				}
			}()
			var pids [2]int32
			for i := range pids {
				config := pool.Config()
				config.MaxConns = 1
				connection, err := pgxpool.NewWithConfig(ctx, config)
				require.NoError(t, err)
				connections = append(connections, connection)
				require.NoError(t, connection.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pids[i]))
			}
			// The first request is descending; PostgreSQL must still lock the lower UUID first.
			if input.Items[0].ID < input.Items[1].ID {
				input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
			}
			other := input
			other.Items = []shortlink.BatchTagItem{input.Items[1], input.Items[0]}
			other.ToTag = "D"
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
			start := func(i int, request shortlink.BatchTagRenameInput) {
				workers.Go(func() {
					svc := shortlink.NewService(connections[i], permission.NewService())
					var result shortlink.BatchTagsResult
					var err error
					if adminScope {
						result, err = svc.RenameAdminTags(ctx, actor, request)
					} else {
						result, err = svc.RenameOwnTags(ctx, actor, request)
					}
					done[i] <- outcome{result, err}
				})
			}
			waitBlockedBy := func(i int, expected int32) {
				t.Helper()
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				for {
					var blockers []int32
					var query, event string
					require.NoError(t, pool.QueryRow(ctx, `select pg_blocking_pids(pid),query,coalesce(wait_event_type,'') from pg_stat_activity where pid=$1`, pids[i]).Scan(&blockers, &query, &event))
					if strings.Contains(query, "-- name: LockBatchTagsShortLinks :many") && event == "Lock" && len(blockers) == 1 && blockers[0] == expected {
						return
					}
					select {
					case result := <-done[i]:
						t.Fatalf("writer %d completed before observed target lock: %+v", i, result)
					case <-ctx.Done():
						t.Fatalf("%v: writer %d query=%q blockers=%v expected=%d", ctx.Err(), i, query, blockers, expected)
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
				require.NotContains(t, tags, "B")
				require.NotContains(t, tags, "D")
			}
			var audits int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and changed_fields=array['tags']`, actor.ID).Scan(&audits))
			require.Equal(t, 2, audits)
		})
	}
}

// TestBatchTagRenameAuthorization catches bypasses of entry grants and current stored actor/group checks.
func TestBatchTagRenameAuthorization(t *testing.T) {
	for _, kind := range []string{"entry own", "entry admin", "invalid actor", "missing actor", "deleted actor", "disabled actor", "guest group", "invalid grants", "invalid input"} {
		t.Run(kind, func(t *testing.T) {
			pool, svc, admin, _, input := tagRenameFixture(t, 1)
			actor := admin
			want := shortlink.ErrPermissionDenied
			switch kind {
			case "entry own", "entry admin":
				svc = shortlink.NewService(pool, permission.NewServiceWithPermissions(nil, nil))
			case "invalid actor":
				actor.ID = "invalid"
			case "missing actor":
				actor.ID = uuid.NewString()
			case "deleted actor", "disabled actor":
				query := `update app_user set deleted_at=now() where id=$1`
				if kind == "disabled actor" {
					query = `update app_user set status='disabled' where id=$1`
				}
				_, err := pool.Exec(t.Context(), query, actor.ID)
				require.NoError(t, err)
			case "guest group":
				_, err := pool.Exec(t.Context(), `update user_group set key='guest' where key='admin'`)
				require.NoError(t, err)
			case "invalid grants":
				_, err := pool.Exec(t.Context(), `update user_group set permissions='{}' where key='admin'`)
				require.NoError(t, err)
				// Preserve a valid entry snapshot so the malformed current row is rejected inside the transaction.
				svc = shortlink.NewService(pool, permission.NewService())
				want = nil
			case "invalid input":
				input.FromTag = input.ToTag
				want = shortlink.ErrInvalidInput
			}
			before := batchTagsSnapshot(t, pool)
			var result shortlink.BatchTagsResult
			var err error
			if kind == "entry own" {
				result, err = svc.RenameOwnTags(t.Context(), actor, input)
			} else {
				result, err = svc.RenameAdminTags(t.Context(), actor, input)
			}
			require.Error(t, err)
			if want != nil {
				require.ErrorIs(t, err, want)
			}
			require.Zero(t, result)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}
