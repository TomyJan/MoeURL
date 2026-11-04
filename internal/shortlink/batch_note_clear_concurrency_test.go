package shortlink_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteClearQueuedAuthorization observes each database wait before committing a revocation.
func TestBatchNoteClearQueuedAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, clear := range []bool{false, true} {
			for _, change := range []struct{ name, sql, query string }{
				{"disabled", `update app_user set status='disabled' where id=$1`, "-- name: LockBatchTagsActor"},
				{"moved", `update app_user set group_id=(select id from user_group where key=$2) where id=$1`, "-- name: LockBatchTagsActor"},
				{"read revoked", `update user_group set permissions=permissions-$2::text where id=(select group_id from app_user where id=$1)`, "-- name: LockTransferActorGroup"},
				{"write revoked", `update user_group set permissions=permissions-$2::text where id=(select group_id from app_user where id=$1)`, "-- name: LockTransferActorGroup"},
				{"metadata revoked", `update user_group set permissions=permissions-'short_link:set_metadata' where id=(select group_id from app_user where id=$1)`, "-- name: LockTransferActorGroup"},
				{"admin revoked", `update user_group set permissions=permissions-'admin:access' where id=(select group_id from app_user where id=$1)`, "-- name: LockTransferActorGroup"},
			} {
				if change.name == "admin revoked" && !adminScope {
					continue
				}
				t.Run(strings.Join([]string{map[bool]string{false: "own", true: "admin"}[adminScope], map[bool]string{false: "preview", true: "clear"}[clear], change.name}, "/"), func(t *testing.T) {
					pool, service, admin, owner, input := batchNoteFixture(t)
					actor := owner
					if adminScope {
						actor = admin
					}
					p, err := service.PreviewAdminNoteClear(t.Context(), admin, input)
					require.NoError(t, err)
					ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
					defer cancel()
					tx, err := pool.Begin(ctx)
					require.NoError(t, err)
					defer func() { testdb.Rollback(t, tx.Rollback) }()
					args := []any{actor.ID}
					switch change.name {
					case "moved":
						args = append(args, map[bool]string{false: "admin", true: "user"}[adminScope])
					case "read revoked":
						args = append(args, map[bool]string{false: permission.ShortLinkReadOwn, true: permission.ShortLinkReadAll}[adminScope])
					case "write revoked":
						args = append(args, map[bool]string{false: permission.ShortLinkUpdateOwn, true: permission.ShortLinkUpdateAll}[adminScope])
					}
					// Moving own to admin must still be an actual revocation, not an accidental grant.
					if change.name == "moved" && !adminScope {
						_, err = tx.Exec(ctx, `update user_group set permissions='[]' where key='admin'`)
						require.NoError(t, err)
					}
					_, err = tx.Exec(ctx, change.sql, args...)
					require.NoError(t, err)
					before := batchTagsSnapshot(t, pool)
					done := make(chan error, 1)
					go func() {
						s := shortlink.NewService(pool, permission.NewService())
						var err error
						if clear {
							if adminScope {
								_, err = s.ClearAdminNotes(ctx, actor, batchNoteClearInput(p))
							} else {
								_, err = s.ClearOwnNotes(ctx, actor, batchNoteClearInput(p))
							}
						} else {
							if adminScope {
								_, err = s.PreviewAdminNoteClear(ctx, actor, input)
							} else {
								_, err = s.PreviewOwnNoteClear(ctx, actor, input)
							}
						}
						done <- err
					}()
					waitBatchTagsLock(t, ctx, pool, change.query, done)
					require.NoError(t, tx.Commit(ctx))
					require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
					require.JSONEq(t, before, batchTagsSnapshot(t, pool))
				})
			}
		}
	}
}

// TestBatchNoteClearConcurrentWriters proves sorted resource locking and the single winning revision.
func TestBatchNoteClearConcurrentWriters(t *testing.T) {
	t.Run("mixed", func(t *testing.T) { runBatchNoteClearConcurrentWriters(t, false) })
	t.Run("empty", func(t *testing.T) { runBatchNoteClearConcurrentWriters(t, true) })
}

func runBatchNoteClearConcurrentWriters(t *testing.T, empty bool) {
	pool, service, admin, _, input := batchNoteFixture(t)
	if empty {
		_, err := pool.Exec(t.Context(), `update short_link set note=''`)
		require.NoError(t, err)
	}
	p, err := service.PreviewAdminNoteClear(t.Context(), admin, input)
	require.NoError(t, err)
	first := batchNoteClearInput(p)
	second := batchNoteClearInput(p)
	// Opposite order requests must both wait on the same smallest UUID.
	for i, j := 0, len(second.Items)-1; i < j; i, j = i+1, j-1 {
		second.Items[i], second.Items[j] = second.Items[j], second.Items[i]
	}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	var pools []*pgxpool.Pool
	var blocker pgx.Tx
	var workers sync.WaitGroup
	defer func() {
		cancel()
		if blocker != nil {
			testdb.Rollback(t, blocker.Rollback)
		}
		workers.Wait()
		for _, p := range pools {
			p.Close()
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
	blocker, err = pool.Begin(ctx)
	require.NoError(t, err)
	_, err = blocker.Exec(ctx, `select id from short_link order by id for update`)
	require.NoError(t, err)
	type outcome struct {
		result shortlink.BatchNoteClearResult
		err    error
	}
	done := []chan outcome{make(chan outcome, 1), make(chan outcome, 1)}
	start := func(i int, request shortlink.BatchNoteClearInput) {
		workers.Go(func() {
			result, err := shortlink.NewService(pools[i], permission.NewService()).ClearAdminNotes(ctx, admin, request)
			done[i] <- outcome{result, err}
		})
	}
	wait := func(i int, expected int32) {
		t.Helper()
		ticker := time.NewTicker(5 * time.Millisecond)
		defer ticker.Stop()
		for {
			var blockers []int32
			var query, event string
			require.NoError(t, pool.QueryRow(ctx, `select pg_blocking_pids(pid),query,coalesce(wait_event_type,'') from pg_stat_activity where pid=$1`, pids[i]).Scan(&blockers, &query, &event))
			if strings.Contains(query, "-- name: LockBatchNoteClearTargets :many") && event == "Lock" && len(blockers) == 1 && blockers[0] == expected {
				return
			}
			select {
			case value := <-done[i]:
				t.Fatalf("completed before lock wait: %+v", value)
			case <-ctx.Done():
				t.Fatalf("%v query=%q blockers=%v", ctx.Err(), query, blockers)
			case <-ticker.C:
			}
		}
	}
	start(0, first)
	wait(0, int32(blocker.Conn().PgConn().PID()))
	start(1, second)
	wait(1, pids[0])
	require.NoError(t, blocker.Commit(ctx))
	winner, loser := <-done[0], <-done[1]
	require.NoError(t, winner.err)
	if empty {
		require.Equal(t, shortlink.BatchNoteClearResult{UnchangedCount: 3}, winner.result)
		require.NoError(t, loser.err)
		require.Equal(t, winner.result, loser.result)
	} else {
		require.Equal(t, shortlink.BatchNoteClearResult{ChangedCount: 2, UnchangedCount: 1}, winner.result)
		require.ErrorIs(t, loser.err, shortlink.ErrTransferConflict)
		require.Zero(t, loser.result)
	}
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where changed_fields=array['note']`).Scan(&count))
	if empty {
		require.Zero(t, count)
	} else {
		require.Equal(t, 2, count)
	}
}

func TestBatchNoteClearQueuedResourceChanges(t *testing.T) {
	for _, clear := range []bool{false, true} {
		for _, change := range []string{"note", "main", "transfer", "cancel"} {
			if !clear && change == "note" {
				continue
			} // Preview intentionally observes the latest locked note revision.
			t.Run(strings.Join([]string{map[bool]string{false: "preview", true: "clear"}[clear], change}, "/"), func(t *testing.T) {
				pool, service, admin, owner, input := batchNoteFixture(t)
				p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
				require.NoError(t, err)
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				tx, err := pool.Begin(ctx)
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, tx.Rollback) }()
				_, err = tx.Exec(ctx, `select id from short_link order by id for update`)
				require.NoError(t, err)
				done := make(chan error, 1)
				go func() {
					s := shortlink.NewService(pool, permission.NewService())
					var err error
					if clear {
						_, err = s.ClearOwnNotes(ctx, owner, batchNoteClearInput(p))
					} else {
						_, err = s.PreviewOwnNoteClear(ctx, owner, input)
					}
					done <- err
				}()
				query := "-- name: LockBatchNoteClearPreview"
				if clear {
					query = "-- name: LockBatchNoteClearTargets"
				}
				waitBatchTagsLock(t, ctx, pool, query, done)
				if change == "cancel" {
					before := batchTagsSnapshot(t, pool)
					cancel()
					require.Error(t, <-done)
					require.JSONEq(t, before, batchTagsSnapshot(t, pool))
					return
				}
				switch change {
				case "note":
					_, err = tx.Exec(ctx, `update short_link set note='new note',note_updated_at=note_updated_at+interval '1 microsecond' where id=$1`, input.Items[2].ID)
				case "main":
					_, err = tx.Exec(ctx, `update short_link set tags=array['changed'],updated_at=updated_at+interval '1 microsecond' where id=$1`, input.Items[2].ID)
				case "transfer":
					_, err = tx.Exec(ctx, `update short_link set owner_id=$2,updated_at=updated_at+interval '1 microsecond' where id=$1`, input.Items[2].ID, admin.ID)
				}
				require.NoError(t, err)
				require.NoError(t, tx.Commit(ctx))
				before := batchTagsSnapshot(t, pool)
				err = <-done
				if change == "transfer" {
					require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
				} else {
					require.ErrorIs(t, err, shortlink.ErrTransferConflict)
				}
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
				if change == "transfer" {
					// Administrative visibility survives transfer, but the pinned main revision must still conflict.
					_, err = service.PreviewAdminNoteClear(t.Context(), admin, input)
					require.ErrorIs(t, err, shortlink.ErrTransferConflict)
					_, err = service.ClearAdminNotes(t.Context(), admin, batchNoteClearInput(p))
					require.ErrorIs(t, err, shortlink.ErrTransferConflict)
					require.JSONEq(t, before, batchTagsSnapshot(t, pool))
				}
			})
		}
	}
}
