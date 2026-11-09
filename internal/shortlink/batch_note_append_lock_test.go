package shortlink_test

import (
	"context"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteAppendQueuedAuthorization catches trusting the entry snapshot after a queued actor/group mutation commits.
func TestBatchNoteAppendQueuedAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		grants := []string{permission.ShortLinkReadOwn, permission.ShortLinkUpdateOwn, permission.ShortLinkSetMetadata}
		if adminScope {
			grants = []string{permission.AdminAccess, permission.ShortLinkReadAll, permission.ShortLinkUpdateAll, permission.ShortLinkSetMetadata}
		}
		changes := append([]string{"disabled", "deleted", "moved", "guest"}, grants...)
		for _, write := range []bool{false, true} {
			for _, change := range changes {
				name := map[bool]string{false: "own", true: "admin"}[adminScope] + "/" + map[bool]string{false: "preview", true: "write"}[write] + "/" + change
				t.Run(name, func(t *testing.T) {
					pool, service, admin, owner, selected := batchNoteFixture(t)
					actor := owner
					if adminScope {
						actor = admin
					}
					previewInput := shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "queued"}
					p, err := service.PreviewAdminNoteAppend(t.Context(), admin, previewInput)
					require.NoError(t, err)
					input := batchNoteAppendInput(p, "queued", uuid.NewString())
					ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
					defer cancel()
					tx, err := pool.Begin(ctx)
					require.NoError(t, err)
					var workers sync.WaitGroup
					defer func() { cancel(); _ = tx.Rollback(context.Background()); workers.Wait() }()
					query := "-- name: LockTransferActorGroup"
					switch change {
					case "disabled", "deleted", "moved":
						query = "-- name: LockBatchTagsActor"
						if write {
							query = "-- name: LockBatchNoteAppendActor"
						}
						if change == "disabled" {
							_, err = tx.Exec(ctx, `update app_user set status='disabled' where id=$1`, actor.ID)
						}
						if change == "deleted" {
							_, err = tx.Exec(ctx, `update app_user set deleted_at=now() where id=$1`, actor.ID)
						}
						if change == "moved" {
							group := uuid.NewString()
							_, err = tx.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'append-restricted','Restricted','[]',false,now(),now())`, group)
							require.NoError(t, err)
							_, err = tx.Exec(ctx, `update app_user set group_id=$2 where id=$1`, actor.ID, group)
						}
					case "guest":
						_, err = tx.Exec(ctx, `update user_group set key='guest' where id=(select group_id from app_user where id=$1)`, actor.ID)
					default:
						_, err = tx.Exec(ctx, `update user_group set permissions=permissions-$2::text where id=(select group_id from app_user where id=$1)`, actor.ID, change)
					}
					require.NoError(t, err)
					before := batchTagsSnapshot(t, pool)
					done := make(chan error, 1)
					workers.Go(func() {
						current := shortlink.NewService(pool, permission.NewService())
						var callErr error
						if write {
							if adminScope {
								_, callErr = current.AppendAdminNotes(ctx, actor, input)
							} else {
								_, callErr = current.AppendOwnNotes(ctx, actor, input)
							}
						} else {
							if adminScope {
								_, callErr = current.PreviewAdminNoteAppend(ctx, actor, previewInput)
							} else {
								_, callErr = current.PreviewOwnNoteAppend(ctx, actor, previewInput)
							}
						}
						done <- callErr
					})
					waitBatchTagsLock(t, ctx, pool, query, done)
					require.NoError(t, tx.Commit(ctx))
					require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
					// Account/group changes are intentional; the entire link/audit snapshot remains unchanged.
					require.JSONEq(t, before, batchTagsSnapshot(t, pool))
					var count int
					require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_note_append_batch`).Scan(&count))
					require.Zero(t, count)
				})
			}
		}
	}
}

// TestBatchNoteAppendReplayAfterTargetChanges catches replay that revalidates or rewrites targets instead of returning the committed receipt.
func TestBatchNoteAppendReplayAfterTargetChanges(t *testing.T) {
	for _, change := range []string{"edited", "transferred", "deleted"} {
		t.Run(change, func(t *testing.T) {
			pool, service, admin, owner, selected := batchNoteFixture(t)
			p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "once"})
			require.NoError(t, err)
			input := batchNoteAppendInput(p, "once", uuid.NewString())
			first, err := service.AppendOwnNotes(t.Context(), owner, input)
			require.NoError(t, err)
			switch change {
			case "edited":
				_, err = pool.Exec(t.Context(), `update short_link set note='later edit',note_updated_at=note_updated_at+interval '1 second' where id=$1`, input.Items[0].ID)
			case "transferred":
				_, err = pool.Exec(t.Context(), `update short_link set owner_id=$2,updated_at=updated_at+interval '1 second' where id=$1`, input.Items[0].ID, admin.ID)
			case "deleted":
				_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now(),updated_at=updated_at+interval '1 second' where id=$1`, input.Items[0].ID)
			}
			require.NoError(t, err)
			before := batchTagsSnapshot(t, pool)
			result, err := service.AppendOwnNotes(t.Context(), owner, input)
			require.NoError(t, err)
			require.Equal(t, first, result)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		})
	}
}

// TestBatchNoteAppendCanceledLockWait leaves no note changes, audit or receipt when cancellation interrupts a real target wait.
func TestBatchNoteAppendCanceledLockWait(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "canceled"})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	var workers sync.WaitGroup
	defer func() { cancel(); _ = tx.Rollback(context.Background()); workers.Wait() }()
	_, err = tx.Exec(ctx, `select id from short_link where id=any($1::uuid[]) order by id for update`, []string{selected.Items[0].ID, selected.Items[1].ID, selected.Items[2].ID})
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	done := make(chan error, 1)
	workers.Go(func() {
		_, err := service.AppendOwnNotes(ctx, owner, batchNoteAppendInput(p, "canceled", uuid.NewString()))
		done <- err
	})
	waitBatchTagsLock(t, ctx, pool, "-- name: LockBatchNoteAppendTargets", done)
	cancel()
	require.Error(t, <-done)
	require.NoError(t, tx.Rollback(context.Background()))
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch`).Scan(&count))
	require.Zero(t, count)
}

// appendWorkerPool fixes one backend PID so tests observe the actual queued operation, not an unrelated connection.
func appendWorkerPool(t *testing.T, pool *pgxpool.Pool) *pgxpool.Pool {
	t.Helper()
	config := pool.Config()
	config.MaxConns = 1
	worker, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	t.Cleanup(worker.Close)
	return worker
}

// TestBatchNoteAppendDifferentKeysConcurrent catches lost updates when independent requests share the same old versions.
func TestBatchNoteAppendDifferentKeysConcurrent(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "winner"})
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	var workers sync.WaitGroup
	defer func() { cancel(); _ = tx.Rollback(context.Background()); workers.Wait() }()
	_, err = tx.Exec(ctx, `select id from app_user where id=$1 for update`, owner.ID)
	require.NoError(t, err)
	done := make(chan error, 2)
	for i := 0; i < 2; i++ {
		worker := appendWorkerPool(t, pool)
		var pid int32
		require.NoError(t, worker.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pid))
		workers.Go(func() {
			_, err := shortlink.NewService(worker, permission.NewService()).AppendOwnNotes(ctx, owner, batchNoteAppendInput(p, "winner", uuid.NewString()))
			done <- err
		})
		ticker := time.NewTicker(time.Millisecond * 5)
		for {
			var waiting bool
			require.NoError(t, pool.QueryRow(ctx, `select coalesce(wait_event_type='Lock',false) and query like '-- name: LockBatchNoteAppendActor%' from pg_stat_activity where pid=$1`, pid).Scan(&waiting))
			if waiting {
				break
			}
			select {
			case <-ticker.C:
			case <-ctx.Done():
				t.Fatal(ctx.Err())
			}
		}
		ticker.Stop()
	}
	require.NoError(t, tx.Commit(ctx))
	one, two := <-done, <-done
	if one == nil {
		require.ErrorIs(t, two, shortlink.ErrTransferConflict)
	} else {
		require.ErrorIs(t, one, shortlink.ErrTransferConflict)
		require.NoError(t, two)
	}
	var receipts int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_note_append_batch`).Scan(&receipts))
	require.Equal(t, 1, receipts)
	var note string
	require.NoError(t, pool.QueryRow(ctx, `select note from short_link where id=$1`, selected.Items[0].ID).Scan(&note))
	require.Equal(t, 1, strings.Count(note, "winner"))
}

// TestBatchNoteAppendQueuedBehindLegacyWriters catches lost legacy edits, partial append, or stale ownership writes.
func TestBatchNoteAppendQueuedBehindLegacyWriters(t *testing.T) {
	for _, operation := range []string{"single edit", "clear", "replace", "transfer"} {
		t.Run(operation, func(t *testing.T) {
			pool, service, admin, owner, selected := batchNoteFixture(t)
			sort.Slice(selected.Items, func(i, j int) bool { return selected.Items[i].ID < selected.Items[j].ID })
			p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "must-not-append"})
			require.NoError(t, err)
			input := batchNoteAppendInput(p, "must-not-append", uuid.NewString())
			// Ensure a clear of the first locked target really changes its note version.
			if operation == "clear" {
				_, err = pool.Exec(t.Context(), `update short_link set note='clear-me' where id=$1`, input.Items[0].ID)
				require.NoError(t, err)
				p, err = service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "must-not-append"})
				require.NoError(t, err)
				input = batchNoteAppendInput(p, "must-not-append", input.RequestID)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			var workers sync.WaitGroup
			defer func() { cancel(); _ = tx.Rollback(context.Background()); workers.Wait() }()
			_, err = tx.Exec(ctx, `select id from short_link where id=any($1::uuid[]) order by id for update`, []string{input.Items[0].ID, input.Items[1].ID, input.Items[2].ID})
			require.NoError(t, err)
			oldDone, newDone := make(chan error, 1), make(chan error, 1)
			query := map[string]string{"single edit": "-- name: LockShortLinkNote", "clear": "-- name: LockBatchNoteClearTargets", "replace": "-- name: LockBatchNoteReplaceTargets", "transfer": "-- name: LockTransferShortLink"}[operation]
			workers.Go(func() {
				var callErr error
				switch operation {
				case "single edit":
					_, callErr = service.UpdateAdminNote(ctx, admin, shortlink.NoteInput{ID: input.Items[0].ID, Note: "legacy edit", ExpectedUpdatedAt: input.Items[0].ExpectedNoteUpdatedAt})
				case "clear":
					_, callErr = service.ClearAdminNotes(ctx, admin, shortlink.BatchNoteClearInput{Items: input.Items})
				case "replace":
					_, callErr = service.ReplaceAdminNotes(ctx, admin, shortlink.BatchNoteReplaceInput{Items: input.Items, Note: "legacy replacement"})
				case "transfer":
					_, callErr = service.Transfer(ctx, admin, shortlink.TransferInput{ID: input.Items[0].ID, NewOwnerUsername: "recipient", ExpectedUpdatedAt: input.Items[0].ExpectedUpdatedAt})
				}
				oldDone <- callErr
			})
			waitBatchTagsLock(t, ctx, pool, query, oldDone)
			workers.Go(func() { _, err := service.AppendOwnNotes(ctx, owner, input); newDone <- err })
			waitBatchTagsLock(t, ctx, pool, "-- name: LockBatchNoteAppendTargets", newDone)
			require.NoError(t, tx.Commit(ctx))
			require.NoError(t, <-oldDone)
			if operation == "transfer" {
				require.ErrorIs(t, <-newDone, shortlink.ErrShortLinkMissing)
			} else {
				require.ErrorIs(t, <-newDone, shortlink.ErrTransferConflict)
			}
			var receipts, audits int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_note_append_batch`).Scan(&receipts))
			require.Zero(t, receipts)
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1`, owner.ID).Scan(&audits))
			require.Zero(t, audits)
			var note string
			require.NoError(t, pool.QueryRow(ctx, `select note from short_link where id=$1`, input.Items[0].ID).Scan(&note))
			require.NotContains(t, note, "must-not-append")
			switch operation {
			case "single edit":
				require.Equal(t, "legacy edit", note)
			case "clear":
				require.Empty(t, note)
			case "replace":
				require.Equal(t, "legacy replacement", note)
			case "transfer":
				var username string
				require.NoError(t, pool.QueryRow(ctx, `select username from app_user where id=(select owner_id from short_link where id=$1)`, input.Items[0].ID).Scan(&username))
				require.Equal(t, "recipient", username)
			}
		})
	}
}

// TestBatchNoteAppendQueuedBehindMembershipChange verifies compatibility with the actual batch membership transaction and its account locks.
func TestBatchNoteAppendQueuedBehindMembershipChange(t *testing.T) {
	for _, write := range []bool{false, true} {
		t.Run(map[bool]string{false: "preview", true: "write"}[write], func(t *testing.T) {
			pool, service, admin, owner, selected := batchNoteFixture(t)
			previewInput := shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "must-not-append"}
			p, err := service.PreviewOwnNoteAppend(t.Context(), owner, previewInput)
			require.NoError(t, err)
			var version time.Time
			require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from app_user where id=$1`, owner.ID).Scan(&version))
			_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:read_own' where key='admin'`)
			require.NoError(t, err)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			var workers sync.WaitGroup
			defer func() { cancel(); _ = tx.Rollback(context.Background()); workers.Wait() }()
			_, err = tx.Exec(ctx, `select id from app_user where id=$1 for update`, owner.ID)
			require.NoError(t, err)
			membershipDone, appendDone := make(chan error, 1), make(chan error, 1)
			workers.Go(func() {
				_, err := user.NewService(pool, permission.NewDatabaseService(pool)).BatchChangeGroup(ctx, admin, user.BatchChangeGroupInput{Items: []user.BatchChangeGroupItem{{ID: owner.ID, ExpectedUpdatedAt: version.UTC().Format(time.RFC3339Nano)}}, GroupKey: "admin"})
				membershipDone <- err
			})
			waitBatchTagsLock(t, ctx, pool, "-- name: LockGroupChangeUsers", membershipDone)
			workers.Go(func() {
				current := shortlink.NewService(pool, permission.NewService())
				var err error
				if write {
					_, err = current.AppendOwnNotes(ctx, owner, batchNoteAppendInput(p, "must-not-append", uuid.NewString()))
				} else {
					_, err = current.PreviewOwnNoteAppend(ctx, owner, previewInput)
				}
				appendDone <- err
			})
			query := "-- name: LockBatchTagsActor"
			if write {
				query = "-- name: LockBatchNoteAppendActor"
			}
			waitBatchTagsLock(t, ctx, pool, query, appendDone)
			require.NoError(t, tx.Commit(ctx))
			require.NoError(t, <-membershipDone)
			require.ErrorIs(t, <-appendDone, shortlink.ErrPermissionDenied)
			var group, note string
			require.NoError(t, pool.QueryRow(ctx, `select g.key from app_user u join user_group g on g.id=u.group_id where u.id=$1`, owner.ID).Scan(&group))
			require.Equal(t, "admin", group)
			require.NoError(t, pool.QueryRow(ctx, `select note from short_link where id=$1`, selected.Items[0].ID).Scan(&note))
			require.Equal(t, "private-canary-猫😀", note)
			var receipts, audits int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_note_append_batch`).Scan(&receipts))
			require.Zero(t, receipts)
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where changed_fields=array['note']`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
}
