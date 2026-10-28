package user_test

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestBatchChangeGroupConcurrentVersion catches a lost CAS or request-order lock inversion on overlapping batches.
func TestBatchChangeGroupConcurrentVersion(t *testing.T) {
	pool, service, actor, first := groupFixture(t)
	second := insertAppUser(t, t.Context(), pool, "second", "", "Second", "user", "active", false)
	items := batchItems(t, pool, first, second)
	start := make(chan struct{})
	done := make(chan error, 2)
	var workers sync.WaitGroup
	for i := range 2 {
		input := user.BatchChangeGroupInput{Items: slices.Clone(items), GroupKey: "admin"}
		if i == 1 {
			slices.Reverse(input.Items)
		}
		workers.Go(func() { <-start; _, err := service.BatchChangeGroup(t.Context(), actor, input); done <- err })
	}
	close(start)
	workers.Wait()
	close(done)
	successes, conflicts := 0, 0
	for err := range done {
		if err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, user.ErrVersionConflict)
			conflicts++
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, conflicts)
}

// TestBatchChangeGroupCrossAdmin prevents two previously privileged actors from demoting each other on stale authority.
func TestBatchChangeGroupCrossAdmin(t *testing.T) {
	pool, service, actor, _ := groupFixture(t)
	other := insertAppUser(t, t.Context(), pool, "other-manager", "", "Other", "admin", "active", false)
	actors := []auth.CurrentUser{actor, {ID: other, GroupKey: "admin"}}
	requests := []user.BatchChangeGroupInput{
		{Items: batchItems(t, pool, other), GroupKey: "user"},
		{Items: batchItems(t, pool, actor.ID), GroupKey: "user"},
	}
	start := make(chan struct{})
	done := make(chan error, 2)
	var workers sync.WaitGroup
	for i := range 2 {
		workers.Go(func() { <-start; _, err := service.BatchChangeGroup(t.Context(), actors[i], requests[i]); done <- err })
	}
	close(start)
	workers.Wait()
	close(done)
	successes, denied := 0, 0
	for err := range done {
		if err == nil {
			successes++
		} else {
			require.ErrorIs(t, err, user.ErrPermissionDenied)
			denied++
		}
	}
	require.Equal(t, 1, successes)
	require.Equal(t, 1, denied)
	var admins int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from app_user u join user_group g on g.id=u.group_id where u.id=any($1::uuid[]) and g.key='admin'`, []string{actor.ID, other}).Scan(&admins))
	require.Equal(t, 1, admins)
}

// waitBatchLock observes a real PostgreSQL lock wait rather than inferring it from scheduling delays.
func waitBatchLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid, blocker int32, done <-chan error) {
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
		case err := <-done:
			t.Fatalf("batch completed before verified lock wait: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
}

// TestBatchChangeGroupWaitingAuthorization proves row and permission locks reauthorize after concurrent revocation commits.
func TestBatchChangeGroupWaitingAuthorization(t *testing.T) {
	for _, kind := range []string{"actor-row", "group-permissions"} {
		t.Run(kind, func(t *testing.T) {
			pool, _, actor, target := groupFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			input := user.BatchChangeGroupInput{Items: batchItems(t, pool, target), GroupKey: "admin"}
			config := pool.Config()
			config.MaxConns = 1
			waiting, err := pgxpool.NewWithConfig(ctx, config)
			require.NoError(t, err)
			defer waiting.Close()
			var pid int32
			require.NoError(t, waiting.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pid))
			blocker, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer blocker.Rollback(context.Background())
			if kind == "actor-row" {
				_, err = blocker.Exec(ctx, `update app_user set group_id=(select id from user_group where key='user') where id=$1`, actor.ID)
			} else {
				_, err = blocker.Exec(ctx, `update user_group set permissions='[]'::jsonb where key='admin'`)
			}
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() { _, err := user.NewService(waiting, nil).BatchChangeGroup(ctx, actor, input); done <- err }()
			waitBatchLock(t, ctx, pool, pid, int32(blocker.Conn().PgConn().PID()), done)
			require.NoError(t, blocker.Commit(ctx))
			require.ErrorIs(t, <-done, user.ErrPermissionDenied)
			require.Equal(t, input.Items, batchItems(t, pool, target))
		})
	}
}

// TestBatchChangeGroupLockOrder observes ascending locks even for a descending HTTP item order and different actors.
func TestBatchChangeGroupLockOrder(t *testing.T) {
	pool, _, actor, first := groupFixture(t)
	second := insertAppUser(t, t.Context(), pool, "second", "", "Second", "user", "active", false)
	other := insertAppUser(t, t.Context(), pool, "other-manager", "", "Manager", "admin", "active", false)
	ids := []string{first, second}
	slices.Sort(ids)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	blocker, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer blocker.Rollback(context.Background())
	_, err = blocker.Exec(ctx, `select id from app_user where id=$1 for update`, ids[1])
	require.NoError(t, err)
	actors := []auth.CurrentUser{actor, {ID: other, GroupKey: "admin"}}
	requests := []user.BatchChangeGroupInput{
		{Items: batchItems(t, pool, ids[1], ids[0]), GroupKey: "admin"},
		{Items: batchItems(t, pool, ids[0], ids[1]), GroupKey: "admin"},
	}
	var pools [2]*pgxpool.Pool
	var pids [2]int32
	done := []chan error{make(chan error, 1), make(chan error, 1)}
	for i := range 2 {
		config := pool.Config()
		config.MaxConns = 1
		pools[i], err = pgxpool.NewWithConfig(ctx, config)
		require.NoError(t, err)
		defer pools[i].Close()
		require.NoError(t, pools[i].QueryRow(ctx, `select pg_backend_pid()`).Scan(&pids[i]))
	}
	go func() {
		_, err := user.NewService(pools[0], nil).BatchChangeGroup(ctx, actors[0], requests[0])
		done[0] <- err
	}()
	waitBatchLock(t, ctx, pool, pids[0], int32(blocker.Conn().PgConn().PID()), done[0])
	go func() {
		_, err := user.NewService(pools[1], nil).BatchChangeGroup(ctx, actors[1], requests[1])
		done[1] <- err
	}()
	waitBatchLock(t, ctx, pool, pids[1], pids[0], done[1])
	require.NoError(t, blocker.Commit(ctx))
	require.NoError(t, <-done[0])
	require.ErrorIs(t, <-done[1], user.ErrVersionConflict)
}

type batchDeadlineTracer struct{ budget chan time.Duration }

// TraceQueryStart records the operation's actual driver context deadline without altering its queries.
func (tr batchDeadlineTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if data.SQL == "begin" {
		deadline, ok := ctx.Deadline()
		if ok {
			tr.budget <- time.Until(deadline)
		} else {
			tr.budget <- 0
		}
	}
	return ctx
}

// TraceQueryEnd leaves the real driver's outcome unchanged.
func (batchDeadlineTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestBatchChangeGroupTimeout catches a missing five-second cap or ignoring the caller's shorter cancellation.
func TestBatchChangeGroupTimeout(t *testing.T) {
	pool, _, actor, id := groupFixture(t)
	input := user.BatchChangeGroupInput{Items: batchItems(t, pool, id), GroupKey: "admin"}
	budget := make(chan time.Duration, 2)
	config := pool.Config()
	config.ConnConfig.Tracer = batchDeadlineTracer{budget}
	observed, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	defer observed.Close()
	_, err = user.NewService(observed, nil).BatchChangeGroup(t.Context(), actor, input)
	require.NoError(t, err)
	require.InDelta(t, float64(5*time.Second), float64(<-budget), float64(time.Second))
	input.Items = batchItems(t, pool, id)
	input.GroupKey = "user"
	blocker, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer blocker.Rollback(context.Background())
	_, err = blocker.Exec(t.Context(), `select id from app_user where id=$1 for update`, id)
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 150*time.Millisecond)
	defer cancel()
	result, err := user.NewService(observed, nil).BatchChangeGroup(ctx, actor, input)
	require.Error(t, err)
	require.ErrorIs(t, ctx.Err(), context.DeadlineExceeded)
	require.Equal(t, user.BatchChangeGroupResult{}, result)
	require.Equal(t, input.Items, batchItems(t, pool, id))
}
