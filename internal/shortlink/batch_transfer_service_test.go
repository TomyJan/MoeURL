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

// batchTransferFixture creates distinct real links at a fixed microsecond version.
func batchTransferFixture(t *testing.T, count int) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, auth.CurrentUser, shortlink.BatchTransferInput) {
	t.Helper()
	pool, service, actor, owner, recipient, single := transferFixture(t)
	input := shortlink.BatchTransferInput{NewOwnerUsername: recipient.Username, Items: []shortlink.BatchTransferItem{{ID: single.ID, ExpectedUpdatedAt: single.ExpectedUpdatedAt}}}
	for i := 1; i < count; i++ {
		id := insertStoredShortLink(t, t.Context(), pool, owner.ID, fmt.Sprintf("batchhandoff%d", i), "https://example.com/keep", "active", false)
		_, err := pool.Exec(t.Context(), `update short_link set updated_at=$2 where id=$1`, id, single.ExpectedUpdatedAt)
		require.NoError(t, err)
		input.Items = append(input.Items, shortlink.BatchTransferItem{ID: id, ExpectedUpdatedAt: single.ExpectedUpdatedAt})
	}
	return pool, service, actor, owner, recipient, input
}

// TestBatchTransfer catches partial handoff, changed non-owner fields and inaccurate no-op accounting.
func TestBatchTransfer(t *testing.T) {
	for _, count := range []int{1, 100} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			pool, service, actor, owner, recipient, input := batchTransferFixture(t, count)
			_, err := pool.Exec(t.Context(), `insert into short_link_access_grant(id,short_link_id,token_hash,expires_at,created_at) values($1,$2,'retained-grant',now()+interval '15 minutes',now())`, uuid.NewString(), input.Items[0].ID)
			require.NoError(t, err)
			var before, after string
			var grantBefore, grantAfter string
			require.NoError(t, pool.QueryRow(t.Context(), `select to_jsonb(g)::text from short_link_access_grant g`).Scan(&grantBefore))
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'owner_id'-'updated_at' order by id)::text from short_link s`).Scan(&before))
			result, err := service.BatchTransfer(t.Context(), actor, input)
			require.NoError(t, err)
			require.Equal(t, shortlink.BatchTransferResult{TransferredCount: count}, result)
			require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(s)-'owner_id'-'updated_at' order by id)::text from short_link s`).Scan(&after))
			require.JSONEq(t, before, after)
			require.NoError(t, pool.QueryRow(t.Context(), `select to_jsonb(g)::text from short_link_access_grant g`).Scan(&grantAfter))
			require.JSONEq(t, grantBefore, grantAfter)
			var changed, audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link where owner_id=$1 and updated_at>'2026-10-23T00:00:00.123456Z'`, recipient.ID).Scan(&changed))
			require.Equal(t, count, changed)
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['owner_id']`, actor.ID).Scan(&audits))
			require.Equal(t, count, audits)
			stats, err := service.Statistics(t.Context(), recipient, shortlink.StatisticsInput{ID: input.Items[0].ID})
			require.NoError(t, err)
			require.Equal(t, int64(1), stats.Stats.VisitCount)
			_, err = service.Statistics(t.Context(), owner, shortlink.StatisticsInput{ID: input.Items[0].ID})
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			for i := range input.Items {
				var updated time.Time
				require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, input.Items[i].ID).Scan(&updated))
				input.Items[i].ExpectedUpdatedAt = updated.UTC().Format(time.RFC3339Nano)
			}
			result, err = service.BatchTransfer(t.Context(), actor, input)
			require.NoError(t, err)
			require.Equal(t, shortlink.BatchTransferResult{UnchangedCount: count}, result)
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
			require.Equal(t, count, audits)
		})
	}
	t.Run("mixed no-op retains version", func(t *testing.T) {
		pool, service, actor, _, recipient, input := batchTransferFixture(t, 2)
		_, err := pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, input.Items[1].ID, recipient.ID)
		require.NoError(t, err)
		result, err := service.BatchTransfer(t.Context(), actor, input)
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchTransferResult{TransferredCount: 1, UnchangedCount: 1}, result)
		var unchanged time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, input.Items[1].ID).Scan(&unchanged))
		require.Equal(t, input.Items[1].ExpectedUpdatedAt, unchanged.UTC().Format(time.RFC3339Nano))
		var audits int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
		require.Equal(t, 1, audits)
	})
}

// TestBatchTransferGuards rejects ambiguous IDs, invalid bounds and stale account authorization.
func TestBatchTransferGuards(t *testing.T) {
	pool, service, actor, owner, recipient, input := batchTransferFixture(t, 2)
	for _, mutate := range []func(*shortlink.BatchTransferInput){
		func(v *shortlink.BatchTransferInput) { v.Items = nil },
		func(v *shortlink.BatchTransferInput) { v.Items = make([]shortlink.BatchTransferItem, 101) },
		func(v *shortlink.BatchTransferInput) { v.Items[1] = v.Items[0] },
		func(v *shortlink.BatchTransferInput) { v.Items[0].ID = "bad" },
		func(v *shortlink.BatchTransferInput) { v.Items[0].ID = uuid.Nil.String() },
		func(v *shortlink.BatchTransferInput) {
			v.Items[0].ID = strings.ToUpper("abcdefab-abcd-abcd-abcd-abcdefabcdef")
		},
		func(v *shortlink.BatchTransferInput) { v.Items[0].ExpectedUpdatedAt = "bad" },
		func(v *shortlink.BatchTransferInput) { v.Items[0].ExpectedUpdatedAt = "0001-01-01T00:00:00Z" },
		func(v *shortlink.BatchTransferInput) { v.NewOwnerUsername = "" },
	} {
		bad := input
		bad.Items = append([]shortlink.BatchTransferItem(nil), input.Items...)
		mutate(&bad)
		_, err := service.BatchTransfer(t.Context(), actor, bad)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	for _, identity := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad", GroupKey: "admin"}, {ID: uuid.Nil.String(), GroupKey: "admin"}, {ID: uuid.NewString(), GroupKey: "admin"}, {ID: owner.ID, GroupKey: "admin"}} {
		_, err := service.BatchTransfer(t.Context(), identity, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	input.NewOwnerUsername = " recipient "
	_, err := service.BatchTransfer(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrTransferRecipientUnavailable)
	input.NewOwnerUsername = recipient.Username
	_, err = pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, recipient.ID)
	require.NoError(t, err)
	_, err = service.BatchTransfer(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrTransferRecipientUnavailable)
	_, err = pool.Exec(t.Context(), `update app_user set status='active' where id=$1;`, recipient.ID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:update_all' where key='admin'`)
	require.NoError(t, err)
	_, err = shortlink.NewService(pool, permission.NewService()).BatchTransfer(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}

// TestBatchTransferCurrentAccounts checks current database state even with an outdated static resolver.
func TestBatchTransferCurrentAccounts(t *testing.T) {
	for _, tc := range []struct {
		name, change string
		want         error
	}{
		{"actor disabled", `update app_user set status='disabled' where username='manager'`, shortlink.ErrPermissionDenied},
		{"actor deleted", `update app_user set deleted_at=now() where username='manager'`, shortlink.ErrPermissionDenied},
		{"actor demoted", `update app_user set group_id=(select id from user_group where key='user') where username='manager'`, shortlink.ErrPermissionDenied},
		{"actor guest", `update user_group set key='guest' where key='admin'`, shortlink.ErrPermissionDenied},
		{"admin access revoked", `update user_group set permissions=permissions-'admin:access' where key='admin'`, shortlink.ErrPermissionDenied},
		{"recipient deleted", `update app_user set deleted_at=now() where username='recipient'`, shortlink.ErrTransferRecipientUnavailable},
		{"recipient guest", `update user_group set key='guest' where key='user'`, shortlink.ErrTransferRecipientUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor, owner, _, input := batchTransferFixture(t, 2)
			_, err := pool.Exec(t.Context(), tc.change)
			require.NoError(t, err)
			result, err := shortlink.NewService(pool, permission.NewService()).BatchTransfer(t.Context(), actor, input)
			require.ErrorIs(t, err, tc.want)
			require.Zero(t, result)
			var retained, audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link where owner_id=$1`, owner.ID).Scan(&retained))
			require.Equal(t, 2, retained)
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
	t.Run("disabled owner to administrator with future version", func(t *testing.T) {
		pool, service, actor, owner, _, input := batchTransferFixture(t, 2)
		_, err := pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, owner.ID)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `update short_link set updated_at='2099-01-01T00:00:00.123456Z'`)
		require.NoError(t, err)
		for i := range input.Items {
			input.Items[i].ExpectedUpdatedAt = "2099-01-01T00:00:00.123456Z"
		}
		input.NewOwnerUsername = actor.Username
		result, err := service.BatchTransfer(t.Context(), actor, input)
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchTransferResult{TransferredCount: 2}, result)
		var monotonic int
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link where owner_id=$1 and updated_at='2099-01-01T00:00:00.123457Z'`, actor.ID).Scan(&monotonic))
		require.Equal(t, 2, monotonic)
	})
}

// TestBatchTransferVersions requires all versions, including no-ops, before any write or audit.
func TestBatchTransferVersions(t *testing.T) {
	for _, kind := range []string{"stale", "noop stale", "missing", "deleted"} {
		t.Run(kind, func(t *testing.T) {
			pool, service, actor, owner, recipient, input := batchTransferFixture(t, 2)
			// The stale item must sort last so a write-as-you-check loop cannot pass by accident.
			if input.Items[0].ID > input.Items[1].ID {
				input.Items[0], input.Items[1] = input.Items[1], input.Items[0]
			}
			// A write before finishing preflight would surface an infrastructure error instead.
			_, err := pool.Exec(t.Context(), `alter table audit_log add constraint preflight_before_write check(false) not valid`)
			require.NoError(t, err)
			want := shortlink.ErrTransferConflict
			switch kind {
			case "stale", "noop stale":
				input.Items[1].ExpectedUpdatedAt = "2026-10-23T00:00:00Z"
				if kind == "noop stale" {
					_, err := pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, input.Items[1].ID, recipient.ID)
					require.NoError(t, err)
				}
			case "missing":
				input.Items[1].ID = uuid.NewString()
				want = shortlink.ErrShortLinkMissing
			case "deleted":
				_, err := pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, input.Items[1].ID)
				require.NoError(t, err)
				want = shortlink.ErrShortLinkMissing
			}
			result, err := service.BatchTransfer(t.Context(), actor, input)
			require.ErrorIs(t, err, want)
			require.Zero(t, result)
			var stored string
			require.NoError(t, pool.QueryRow(t.Context(), `select owner_id::text from short_link where id=$1`, input.Items[0].ID).Scan(&stored))
			require.Equal(t, owner.ID, stored)
			var audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
}

// TestBatchTransferRollback injects real transaction, lock, write and audit failures.
func TestBatchTransferRollback(t *testing.T) {
	pool, _, actor, owner, _, input := batchTransferFixture(t, 2)
	for _, prefix := range []string{"begin", "-- name: LockTransferUsers", "-- name: LockTransferActorGroup", "-- name: LockBatchTransferShortLinks", "-- name: TransferShortLinkOwner", "commit"} {
		t.Run(prefix, func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = transferFaultTracer{prefix}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(faulty.Close)
			result, err := shortlink.NewService(faulty, permission.NewService()).BatchTransfer(t.Context(), actor, input)
			require.Error(t, err)
			require.Zero(t, result)
		})
	}
	// Reject the second ordered write after the first link and its audit were inserted.
	var lastID string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from short_link order by id desc limit 1`).Scan(&lastID))
	_, err := pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_batch_transfer check(resource_id <> '%s') not valid`, lastID))
	require.NoError(t, err)
	_, err = shortlink.NewService(pool, permission.NewService()).BatchTransfer(t.Context(), actor, input)
	require.Error(t, err)
	var retained, audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link where owner_id=$1 and updated_at='2026-10-23T00:00:00.123456Z'`, owner.ID).Scan(&retained))
	require.Equal(t, 2, retained)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
	require.Zero(t, audits)
}

type batchCommitBarrier struct {
	entered chan struct{}
	release chan struct{}
}

// TraceQueryStart pauses immediately before the real commit while all transferred rows remain locked.
func (b batchCommitBarrier) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if data.SQL == "commit" {
		close(b.entered)
		select {
		case <-b.release:
		case <-ctx.Done():
		}
	}
	return ctx
}

// TraceQueryEnd leaves the real driver's transaction result intact.
func (batchCommitBarrier) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestBatchTransferOldOwnerWait rejects writes that began while the handoff was still uncommitted.
func TestBatchTransferOldOwnerWait(t *testing.T) {
	for _, action := range []string{"update", "delete"} {
		t.Run(action, func(t *testing.T) {
			pool, service, actor, owner, _, input := batchTransferFixture(t, 2)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			barrier := batchCommitBarrier{make(chan struct{}), make(chan struct{})}
			var release sync.Once
			defer release.Do(func() { close(barrier.release) })
			config := pool.Config()
			config.ConnConfig.Tracer = barrier
			blocked, err := pgxpool.NewWithConfig(ctx, config)
			require.NoError(t, err)
			defer blocked.Close()
			handoff := make(chan error, 1)
			go func() {
				_, err := shortlink.NewService(blocked, permission.NewService()).BatchTransfer(ctx, actor, input)
				handoff <- err
			}()
			select {
			case <-barrier.entered:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
			write := make(chan error, 1)
			go func() {
				if action == "update" {
					_, err := service.Update(ctx, owner, shortlink.UpdateInput{ID: input.Items[0].ID, Status: ptr("active")})
					write <- err
				} else {
					write <- service.Delete(ctx, owner, shortlink.DeleteInput{ID: input.Items[0].ID})
				}
			}()
			ticker := time.NewTicker(5 * time.Millisecond)
			defer ticker.Stop()
			for {
				var waiting bool
				require.NoError(t, pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and (query like '-- name: UpdateOwnShortLink%' or query like '-- name: SoftDeleteOwnShortLink%'))`).Scan(&waiting))
				if waiting {
					break
				}
				select {
				case err := <-write:
					t.Fatalf("old owner completed before lock wait: %v", err)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-ticker.C:
				}
			}
			release.Do(func() { close(barrier.release) })
			require.NoError(t, <-handoff)
			require.ErrorIs(t, <-write, shortlink.ErrShortLinkMissing)
		})
	}
}

// TestBatchTransferConcurrent catches request-order locking by observing independent batches waiting on sorted link rows.
func TestBatchTransferConcurrent(t *testing.T) {
	pool, _, actor, _, recipient, input := batchTransferFixture(t, 2)
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
	var adminGroupID string
	require.NoError(t, pool.QueryRow(ctx, `select group_id::text from app_user where id=$1`, actor.ID).Scan(&adminGroupID))
	otherActor := insertShortLinkUserForGroup(t, ctx, pool, "other-manager", adminGroupID, uuid.NewString(), "admin", permission.AdminPermissions)
	actors := []auth.CurrentUser{actor, otherActor}
	var pids [2]int32
	for i := range actors {
		config := pool.Config()
		config.MaxConns = 1
		connection, err := pgxpool.NewWithConfig(ctx, config)
		require.NoError(t, err)
		connections = append(connections, connection)
		require.NoError(t, connection.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pids[i]))
	}
	first := input
	first.Items = append([]shortlink.BatchTransferItem(nil), input.Items...)
	if first.Items[0].ID < first.Items[1].ID {
		first.Items[0], first.Items[1] = first.Items[1], first.Items[0]
	}
	second := shortlink.BatchTransferInput{NewOwnerUsername: otherActor.Username, Items: []shortlink.BatchTransferItem{first.Items[1], first.Items[0]}}
	var err error
	blocker, err = pool.Begin(ctx)
	require.NoError(t, err)
	_, err = blocker.Exec(ctx, `select id from short_link where id=$1 for update`, first.Items[0].ID)
	require.NoError(t, err)
	type outcome struct {
		result shortlink.BatchTransferResult
		err    error
	}
	done := []chan outcome{make(chan outcome, 1), make(chan outcome, 1)}
	start := func(i int, request shortlink.BatchTransferInput) {
		workers.Go(func() {
			result, err := shortlink.NewService(connections[i], permission.NewDatabaseService(connections[i])).BatchTransfer(ctx, actors[i], request)
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
			if len(blockers) != 0 {
				require.Equal(t, []int32{expected}, blockers, "batch %d must wait only on the expected link-lock holder", i)
				return
			}
			select {
			case result := <-done[i]:
				t.Fatalf("batch %d finished before the expected lock wait: %+v", i, result)
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			case <-ticker.C:
			}
		}
	}
	// The first request is descending, but must hold the lower ID before waiting on the higher ID.
	start(0, first)
	waitBlockedBy(0, int32(blocker.Conn().PgConn().PID()))
	// Different actor/recipient rows and compatible group locks force this wait onto the lower link.
	start(1, second)
	waitBlockedBy(1, pids[0])
	require.NoError(t, blocker.Commit(ctx))
	winner, loser := <-done[0], <-done[1]
	require.NoError(t, winner.err)
	require.Equal(t, shortlink.BatchTransferResult{TransferredCount: 2}, winner.result)
	require.ErrorIs(t, loser.err, shortlink.ErrTransferConflict)
	require.Equal(t, shortlink.BatchTransferResult{}, loser.result)
	var transferred, audits int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where owner_id=$1`, recipient.ID).Scan(&transferred))
	require.Equal(t, 2, transferred)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and changed_fields=array['owner_id']`, actor.ID).Scan(&audits))
	require.Equal(t, 2, audits)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1`, otherActor.ID).Scan(&audits))
	require.Zero(t, audits)
}

// TestBatchTransferWaitsForRecipient uses a visible row-lock wait to prove fresh account validation.
func TestBatchTransferWaitsForRecipient(t *testing.T) {
	pool, _, actor, owner, recipient, input := batchTransferFixture(t, 2)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	_, err = tx.Exec(ctx, `update app_user set status='disabled' where id=$1`, recipient.ID)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() {
		_, err := shortlink.NewService(pool, permission.NewService()).BatchTransfer(ctx, actor, input)
		done <- err
	}()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		require.NoError(t, pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockTransferUsers%')`).Scan(&waiting))
		if waiting {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("completed before lock wait: %v", err)
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-ticker.C:
		}
	}
	require.NoError(t, tx.Commit(ctx))
	require.ErrorIs(t, <-done, shortlink.ErrTransferRecipientUnavailable)
	var retained int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where owner_id=$1`, owner.ID).Scan(&retained))
	require.Equal(t, 2, retained)
}
