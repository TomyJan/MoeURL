package shortlink_test

import (
	"context"
	"encoding/json"
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

// noteFixture retains all the legacy settings and history so an accidental broad update is observable.
func noteFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, auth.CurrentUser, shortlink.NoteInput) {
	t.Helper()
	pool, service, admin, owner, recipient, transfer := transferFixture(t)
	result, err := service.ReadOwnNote(t.Context(), owner, transfer.ID)
	require.NoError(t, err)
	return pool, service, admin, owner, recipient, shortlink.NoteInput{ID: transfer.ID, Note: "private note", ExpectedUpdatedAt: result.UpdatedAt}
}

// TestNoteAuditRollbackAndNoop catches a broad settings update, text-bearing audit, stale no-op and partial write.
func TestNoteAuditRollbackAndNoop(t *testing.T) {
	pool, service, admin, owner, _, input := noteFixture(t)
	ctx := t.Context()
	snapshot := func() string {
		var value string
		require.NoError(t, pool.QueryRow(ctx, `select jsonb_build_object('link',(select to_jsonb(s)-'note'-'note_updated_at' from short_link s where id=$1),'events',(select jsonb_agg(to_jsonb(e)) from short_link_event e))::text`, input.ID).Scan(&value))
		return value
	}
	before := snapshot()
	result, err := service.UpdateOwnNote(ctx, owner, input)
	require.NoError(t, err)
	require.Equal(t, "private note", result.Note)
	require.JSONEq(t, before, snapshot())
	old, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	require.NoError(t, err)
	newVersion, err := time.Parse(time.RFC3339Nano, result.UpdatedAt)
	require.NoError(t, err)
	require.True(t, newVersion.After(old))
	var audit string
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_build_object('actor',actor_id,'fields',changed_fields)::text from audit_log`).Scan(&audit))
	require.JSONEq(t, `{"actor":"`+owner.ID+`","fields":["note"]}`, audit)
	_, err = service.UpdateOwnNote(ctx, owner, input)
	require.ErrorIs(t, err, shortlink.ErrTransferConflict)
	input.ExpectedUpdatedAt = result.UpdatedAt
	unchanged, err := service.UpdateAdminNote(ctx, admin, input)
	require.NoError(t, err)
	require.Equal(t, result, unchanged)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
	_, err = pool.Exec(ctx, `alter table audit_log add constraint reject_note_audit check(false) not valid`)
	require.NoError(t, err)
	allBefore := batchTagsSnapshot(t, pool)
	input.Note = "must roll back"
	_, err = service.UpdateAdminNote(ctx, admin, input)
	require.Error(t, err)
	require.JSONEq(t, allBefore, batchTagsSnapshot(t, pool))
}

// TestNoteCurrentAuthorization catches trusting entrance grants after account, group or owner changes.
func TestNoteCurrentAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, write := range []bool{false, true} {
			for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
				t.Run(strings.Join([]string{map[bool]string{true: "admin", false: "own"}[adminScope], map[bool]string{true: "write", false: "read"}[write], change}, "/"), func(t *testing.T) {
					pool, _, admin, owner, _, input := noteFixture(t)
					actor := owner
					if adminScope {
						actor = admin
					}
					resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
						var err error
						switch change {
						case "disabled":
							_, err = pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
						case "deleted":
							_, err = pool.Exec(t.Context(), `update app_user set deleted_at=now() where id=$1`, actor.ID)
						case "guest":
							_, err = pool.Exec(t.Context(), `update user_group set key='guest' where id=(select group_id from app_user where id=$1)`, actor.ID)
						case "revoked":
							_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where id=(select group_id from app_user where id=$1)`, actor.ID)
						case "moved":
							group := uuid.NewString()
							_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'unprivileged','Restricted','[]',false,now(),now())`, group)
							require.NoError(t, err)
							_, err = pool.Exec(t.Context(), `update app_user set group_id=$2 where id=$1`, actor.ID, group)
						}
						require.NoError(t, err)
					}}
					service := shortlink.NewService(pool, resolver)
					var result shortlink.NoteResult
					var err error
					if write {
						if adminScope {
							result, err = service.UpdateAdminNote(t.Context(), actor, input)
						} else {
							result, err = service.UpdateOwnNote(t.Context(), actor, input)
						}
					} else {
						if adminScope {
							result, err = service.ReadAdminNote(t.Context(), actor, input.ID)
						} else {
							result, err = service.ReadOwnNote(t.Context(), actor, input.ID)
						}
					}
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
					require.Zero(t, result)
					var note string
					require.NoError(t, pool.QueryRow(t.Context(), `select note from short_link where id=$1`, input.ID).Scan(&note))
					require.Empty(t, note)
				})
			}
		}
	}
}

// TestNoteTransferAndIsolation catches notes leaking to a previous owner or disappearing during handoff.
func TestNoteTransferAndIsolation(t *testing.T) {
	pool, service, admin, owner, recipient, input := noteFixture(t)
	ctx := t.Context()
	saved, err := service.UpdateOwnNote(ctx, owner, input)
	require.NoError(t, err)
	_, err = service.Transfer(ctx, admin, shortlink.TransferInput{ID: input.ID, NewOwnerUsername: recipient.Username, ExpectedUpdatedAt: "2026-10-23T00:00:00.123456Z"})
	require.NoError(t, err)
	_, err = service.ReadOwnNote(ctx, owner, input.ID)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	input.ExpectedUpdatedAt = saved.UpdatedAt
	_, err = service.UpdateOwnNote(ctx, owner, input)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	read, err := service.ReadOwnNote(ctx, recipient, input.ID)
	require.NoError(t, err)
	require.Equal(t, saved, read)
	listed, err := service.AdminList(ctx, admin, shortlink.ListInput{})
	require.NoError(t, err)
	raw, err := json.Marshal(listed)
	require.NoError(t, err)
	require.NotContains(t, string(raw), "private note")
	require.NotContains(t, string(raw), "noteUpdatedAt")
	_, err = pool.Exec(ctx, `update short_link set deleted_at=now() where id=$1`, input.ID)
	require.NoError(t, err)
	_, err = service.ReadAdminNote(ctx, admin, input.ID)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	_, err = service.UpdateAdminNote(ctx, admin, input)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
}

// TestNoteConcurrentWriters catches lost updates and exclusive account/group locking before the resource lock.
func TestNoteConcurrentWriters(t *testing.T) {
	pool, _, admin, _, _, input := noteFixture(t)
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
		p, err := pgxpool.NewWithConfig(ctx, config)
		require.NoError(t, err)
		pools = append(pools, p)
		require.NoError(t, p.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pids[i]))
	}
	var err error
	blocker, err = pool.Begin(ctx)
	require.NoError(t, err)
	_, err = blocker.Exec(ctx, `select id from short_link where id=$1 for update`, input.ID)
	require.NoError(t, err)
	type outcome struct {
		result shortlink.NoteResult
		err    error
	}
	done := []chan outcome{make(chan outcome, 1), make(chan outcome, 1)}
	start := func(i int) {
		workers.Go(func() {
			request := input
			request.Note = []string{"winner", "loser"}[i]
			result, err := shortlink.NewService(pools[i], permission.NewService()).UpdateAdminNote(ctx, admin, request)
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
			if strings.Contains(query, "-- name: LockShortLinkNote :one") && event == "Lock" && len(blockers) == 1 && blockers[0] == expected {
				return
			}
			select {
			case result := <-done[i]:
				t.Fatalf("writer completed before resource wait: %+v", result)
			case <-ctx.Done():
				t.Fatalf("wait %d: %v query=%q blockers=%v", i, ctx.Err(), query, blockers)
			case <-ticker.C:
			}
		}
	}
	start(0)
	wait(0, int32(blocker.Conn().PgConn().PID()))
	start(1)
	wait(1, pids[0])
	require.NoError(t, blocker.Commit(ctx))
	winner, loser := <-done[0], <-done[1]
	require.NoError(t, winner.err)
	require.Equal(t, "winner", winner.result.Note)
	require.ErrorIs(t, loser.err, shortlink.ErrTransferConflict)
	require.Zero(t, loser.result)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where changed_fields=array['note']`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestNoteRejectsInvalidInputs catches service callers bypassing HTTP validation and corrupting the revision contract.
func TestNoteRejectsInvalidInputs(t *testing.T) {
	pool, service, _, owner, _, input := noteFixture(t)
	for _, actorID := range []string{"", "bad", uuid.Nil.String()} {
		actor := owner
		actor.ID = actorID
		_, err := service.ReadOwnNote(t.Context(), actor, input.ID)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = service.UpdateOwnNote(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	for _, version := range []string{"", "bad", "0001-01-01T00:00:00Z", "0000-01-01T00:00:00Z", "9999-12-31T23:59:59-01:00", "0001-01-01T00:00:00+01:00"} {
		request := input
		request.ExpectedUpdatedAt = version
		_, err := service.UpdateOwnNote(t.Context(), owner, request)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput, version)
	}
	for _, id := range []string{"", "bad", uuid.Nil.String(), "AF000000-0000-0000-0000-000000000001"} {
		request := input
		request.ID = id
		_, err := service.UpdateOwnNote(t.Context(), owner, request)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	request := input
	request.Note = string([]byte{0xff})
	_, err := service.UpdateOwnNote(t.Context(), owner, request)
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	guest := auth.GuestUser()
	guest.ID = owner.ID
	_, err = service.ReadOwnNote(t.Context(), guest, input.ID)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = service.UpdateOwnNote(t.Context(), guest, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	actor := owner
	actor.ID = uuid.NewString()
	_, err = shortlink.NewService(pool, permission.NewService()).UpdateOwnNote(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
}

// TestNoteStorageFailure catches infrastructure failures being mistaken for empty data or successful writes.
func TestNoteStorageFailure(t *testing.T) {
	for _, corruption := range []string{"actor storage", "group storage", "group JSON", "note storage"} {
		t.Run(corruption, func(t *testing.T) {
			pool, _, _, owner, _, input := noteFixture(t)
			service := shortlink.NewService(pool, permission.NewService())
			var err error
			switch corruption {
			case "actor storage":
				_, err = pool.Exec(t.Context(), `alter table app_user rename to inaccessible_actor`)
			case "group storage":
				_, err = pool.Exec(t.Context(), `alter table user_group rename column permissions to inaccessible_grants`)
			case "group JSON":
				_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where id=(select group_id from app_user where id=$1)`, owner.ID)
			case "note storage":
				_, err = pool.Exec(t.Context(), `alter table short_link rename column note to inaccessible_note`)
			}
			require.NoError(t, err)
			result, err := service.UpdateOwnNote(t.Context(), owner, input)
			require.Error(t, err)
			require.Zero(t, result)
			if corruption != "group JSON" {
				result, err = service.ReadOwnNote(t.Context(), owner, input.ID)
				require.Error(t, err)
				require.Zero(t, result)
			}
		})
	}
}

// TestNoteCustomGroupAndCurrentOwner catches treating builtin group names or the entrance owner as authority.
func TestNoteCustomGroupAndCurrentOwner(t *testing.T) {
	pool, _, _, owner, recipient, input := noteFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set key='curator',builtin=false where id=(select group_id from app_user where id=$1)`, owner.ID)
	require.NoError(t, err)
	owner.GroupKey = "curator"
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	saved, err := service.UpdateOwnNote(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, "private note", saved.Note)
	for _, write := range []bool{false, true} {
		_, err = pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, input.ID, owner.ID)
		require.NoError(t, err)
		resolver := tagCatalogResolver{delegate: permission.NewDatabaseService(pool), before: func() {
			_, err := pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, input.ID, recipient.ID)
			require.NoError(t, err)
		}}
		service := shortlink.NewService(pool, resolver)
		if write {
			input.ExpectedUpdatedAt = saved.UpdatedAt
			_, err = service.UpdateOwnNote(t.Context(), owner, input)
		} else {
			_, err = service.ReadOwnNote(t.Context(), owner, input.ID)
		}
		require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	}
}
