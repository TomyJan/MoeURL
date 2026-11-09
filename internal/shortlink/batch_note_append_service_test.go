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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func batchNoteAppendInput(preview shortlink.BatchNoteAppendPreviewResult, note, requestID string) shortlink.BatchNoteAppendInput {
	input := shortlink.BatchNoteAppendInput{RequestID: requestID, Note: note}
	for _, item := range preview.Items {
		input.Items = append(input.Items, shortlink.BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt, ExpectedNoteUpdatedAt: item.ExpectedNoteUpdatedAt})
	}
	return input
}

// TestBatchNoteAppendPreservesOldTextAndReplaysReceipt checks ordered append, two-version stability, audit and request idempotency.
func TestBatchNoteAppendPreservesOldTextAndReplaysReceipt(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	beforePreview := batchTagsSnapshot(t, pool)
	previewInput := shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: " \r\nadded\t "}
	preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, previewInput)
	require.NoError(t, err)
	require.Equal(t, 3, preview.AppendableCount)
	require.Zero(t, preview.OverflowCount)
	require.Len(t, preview.Items, 3)
	require.JSONEq(t, beforePreview, batchTagsSnapshot(t, pool))
	requestID := uuid.NewString()
	input := batchNoteAppendInput(preview, "added", requestID)
	for _, field := range []string{"main", "note"} {
		stale := batchNoteAppendInput(preview, "added", uuid.NewString())
		version := &stale.Items[2].ExpectedUpdatedAt
		if field == "note" {
			version = &stale.Items[2].ExpectedNoteUpdatedAt
		}
		parsed, parseErr := time.Parse(time.RFC3339Nano, *version)
		require.NoError(t, parseErr)
		*version = parsed.Add(time.Nanosecond).Format(time.RFC3339Nano)
		beforeStale := batchTagsSnapshot(t, pool)
		_, err = service.AppendOwnNotes(t.Context(), owner, stale)
		require.ErrorIs(t, err, shortlink.ErrTransferConflict)
		require.JSONEq(t, beforeStale, batchTagsSnapshot(t, pool))
	}
	var mainBefore string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id)::text from short_link`).Scan(&mainBefore))
	result, err := service.AppendOwnNotes(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, shortlink.BatchNoteAppendResult{RequestID: requestID, AppendedCount: 3}, result)
	wantNotes := []string{"private-canary-猫😀\nadded", "\ufeff\nadded", "added"}
	for i, item := range input.Items {
		var got string
		var main time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select note,updated_at from short_link where id=$1`, item.ID).Scan(&got, &main))
		require.Equal(t, wantNotes[i], got)
		require.Equal(t, item.ExpectedUpdatedAt, main.UTC().Format(time.RFC3339Nano))
	}
	var mainAfter string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(jsonb_build_object('id',id,'updated_at',updated_at) order by id)::text from short_link`).Scan(&mainAfter))
	require.JSONEq(t, mainBefore, mainAfter)
	var auditCount, receiptCount int
	var requestHash []byte
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&auditCount))
	require.Equal(t, 3, auditCount)
	var auditBody string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(a))::text from audit_log a`).Scan(&auditBody))
	require.NotContains(t, auditBody, "private-canary")
	require.NotContains(t, auditBody, "added")
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, requestID).Scan(&receiptCount))
	require.Equal(t, 1, receiptCount)
	require.NoError(t, pool.QueryRow(t.Context(), `select request_hash from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, requestID).Scan(&requestHash))
	require.Len(t, requestHash, 32)
	afterWrite := batchTagsSnapshot(t, pool)

	replay, err := service.AppendOwnNotes(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, result, replay)
	require.JSONEq(t, afterWrite, batchTagsSnapshot(t, pool))
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, requestID).Scan(&receiptCount))
	require.Equal(t, 1, receiptCount)
	for i := range input.Items {
		input.Items[i].ExpectedUpdatedAt = strings.TrimSuffix(input.Items[i].ExpectedUpdatedAt, "Z") + "+00:00"
		input.Items[i].ExpectedNoteUpdatedAt = strings.TrimSuffix(input.Items[i].ExpectedNoteUpdatedAt, "Z") + "+00:00"
	}
	replay, err = service.AppendOwnNotes(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, result, replay)
	require.JSONEq(t, afterWrite, batchTagsSnapshot(t, pool))

	input.Note = "different"
	_, err = service.AppendOwnNotes(t.Context(), owner, input)
	require.ErrorIs(t, err, shortlink.ErrNoteAppendRequestConflict)
	require.JSONEq(t, afterWrite, batchTagsSnapshot(t, pool))
}

// TestBatchNoteAppendReceiptsAreActorScoped keeps one actor's replay history separate from another actor's request ID.
func TestBatchNoteAppendReceiptsAreActorScoped(t *testing.T) {
	pool, service, admin, owner, selected := batchNoteFixture(t)
	preview, err := service.PreviewAdminNoteAppend(t.Context(), admin, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "same"})
	require.NoError(t, err)
	first := batchNoteAppendInput(preview, "same", uuid.NewString())
	firstResult, err := service.AppendOwnNotes(t.Context(), owner, first)
	require.NoError(t, err)
	require.Equal(t, 3, firstResult.AppendedCount)
	current := shortlink.BatchNoteAppendPreviewInput{Note: "same", Items: make([]shortlink.BatchNotePreviewItem, 0, len(first.Items))}
	for _, item := range first.Items {
		var main time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, item.ID).Scan(&main))
		current.Items = append(current.Items, shortlink.BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: main.UTC().Format(time.RFC3339Nano)})
	}
	secondPreview, err := service.PreviewAdminNoteAppend(t.Context(), admin, current)
	require.NoError(t, err)
	second := batchNoteAppendInput(secondPreview, "same", first.RequestID)
	secondResult, err := service.AppendAdminNotes(t.Context(), admin, second)
	require.NoError(t, err)
	require.Equal(t, 3, secondResult.AppendedCount)
	var note string
	require.NoError(t, pool.QueryRow(t.Context(), `select note from short_link where id=$1`, first.Items[0].ID).Scan(&note))
	require.Equal(t, "private-canary-猫😀\nsame\nsame", note)
}

func TestBatchNoteAppendConcurrentSameKey(t *testing.T) {
	for _, differentContent := range []bool{false, true} {
		t.Run(map[bool]string{false: "same content replays", true: "different content conflicts"}[differentContent], func(t *testing.T) {
			pool, service, _, owner, selected := batchNoteFixture(t)
			preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "first"})
			require.NoError(t, err)
			first := batchNoteAppendInput(preview, "first", uuid.NewString())
			second := first
			second.Items = append([]shortlink.BatchNoteClearItem(nil), first.Items...)
			if differentContent {
				second.Note = "second"
			}
			start := make(chan struct{})
			results := make(chan error, 2)
			var wait sync.WaitGroup
			for _, input := range []shortlink.BatchNoteAppendInput{first, second} {
				wait.Add(1)
				go func(input shortlink.BatchNoteAppendInput) {
					defer wait.Done()
					<-start
					_, callErr := service.AppendOwnNotes(t.Context(), owner, input)
					results <- callErr
				}(input)
			}
			close(start)
			wait.Wait()
			close(results)
			var success, conflict int
			for callErr := range results {
				if callErr == nil {
					success++
				} else if differentContent && callErr == shortlink.ErrNoteAppendRequestConflict {
					conflict++
				} else {
					require.NoError(t, callErr)
				}
			}
			if differentContent {
				require.Equal(t, 1, success)
				require.Equal(t, 1, conflict)
			} else {
				require.Equal(t, 2, success)
			}
			var receipts, audits int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, first.RequestID).Scan(&receipts))
			require.Equal(t, 1, receipts)
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&audits))
			require.Equal(t, 3, audits)
		})
	}
}

func TestBatchNoteAppendConcurrentRequestsWaitForActorLock(t *testing.T) {
	for _, differentContent := range []bool{false, true} {
		t.Run(map[bool]string{false: "replay", true: "content conflict"}[differentContent], func(t *testing.T) {
			pool, _, _, owner, selected := batchNoteFixture(t)
			service := shortlink.NewService(pool, permission.NewService())
			preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "first"})
			require.NoError(t, err)
			first := batchNoteAppendInput(preview, "first", uuid.NewString())
			second := first
			second.Items = append([]shortlink.BatchNoteClearItem(nil), first.Items...)
			if differentContent {
				second.Note = "second"
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
			blocker, err = pool.Begin(ctx)
			require.NoError(t, err)
			_, err = blocker.Exec(ctx, `select id from app_user where id=$1 for update`, owner.ID)
			require.NoError(t, err)
			type outcome struct {
				result shortlink.BatchNoteAppendResult
				err    error
			}
			done := []chan outcome{make(chan outcome, 1), make(chan outcome, 1)}
			start := func(i int, input shortlink.BatchNoteAppendInput) {
				workers.Go(func() {
					result, callErr := shortlink.NewService(pools[i], permission.NewService()).AppendOwnNotes(ctx, owner, input)
					done[i] <- outcome{result, callErr}
				})
			}
			wait := func(i int) {
				t.Helper()
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				for {
					var blockers []int32
					var query, event string
					require.NoError(t, pool.QueryRow(ctx, `select pg_blocking_pids(pid),query,coalesce(wait_event_type,'') from pg_stat_activity where pid=$1`, pids[i]).Scan(&blockers, &query, &event))
					if strings.Contains(query, "-- name: LockBatchNoteAppendActor :one") && event == "Lock" && len(blockers) > 0 {
						return
					}
					select {
					case value := <-done[i]:
						t.Fatalf("completed before actor lock wait: %+v", value)
					case <-ctx.Done():
						t.Fatalf("%v query=%q blockers=%v", ctx.Err(), query, blockers)
					case <-ticker.C:
					}
				}
			}
			start(0, first)
			wait(0)
			start(1, second)
			wait(1)
			require.NoError(t, blocker.Commit(ctx))
			blocker = nil
			firstResult, secondResult := <-done[0], <-done[1]
			if differentContent {
				if firstResult.err == nil {
					require.ErrorIs(t, secondResult.err, shortlink.ErrNoteAppendRequestConflict)
					require.Equal(t, 3, firstResult.result.AppendedCount)
				} else {
					require.ErrorIs(t, firstResult.err, shortlink.ErrNoteAppendRequestConflict)
					require.NoError(t, secondResult.err)
					require.Equal(t, 3, secondResult.result.AppendedCount)
				}
			} else {
				require.NoError(t, firstResult.err)
				require.NoError(t, secondResult.err)
				require.Equal(t, firstResult.result, secondResult.result)
				require.Equal(t, 3, firstResult.result.AppendedCount)
			}
			var audits int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&audits))
			require.Equal(t, 3, audits)
		})
	}
}

func TestBatchNoteAppendReplayRequiresCurrentPermission(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
		t.Run(change, func(t *testing.T) {
			pool, service, _, owner, selected := batchNoteFixture(t)
			preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "once"})
			require.NoError(t, err)
			input := batchNoteAppendInput(preview, "once", uuid.NewString())
			first, err := service.AppendOwnNotes(t.Context(), owner, input)
			require.NoError(t, err)
			require.Equal(t, 3, first.AppendedCount)
			resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
				var mutationErr error
				switch change {
				case "disabled":
					_, mutationErr = pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, owner.ID)
				case "deleted":
					_, mutationErr = pool.Exec(t.Context(), `update app_user set deleted_at=now() where id=$1`, owner.ID)
				case "guest":
					_, mutationErr = pool.Exec(t.Context(), `update user_group set key='guest' where id=(select group_id from app_user where id=$1)`, owner.ID)
				case "revoked":
					_, mutationErr = pool.Exec(t.Context(), `update user_group set permissions='[]' where id=(select group_id from app_user where id=$1)`, owner.ID)
				case "moved":
					groupID := uuid.NewString()
					_, mutationErr = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'batch-append-restricted','Restricted','[]'::jsonb,false,now(),now())`, groupID)
					if mutationErr == nil {
						_, mutationErr = pool.Exec(t.Context(), `update app_user set group_id=$1 where id=$2`, groupID, owner.ID)
					}
				}
				require.NoError(t, mutationErr)
			}}
			current := shortlink.NewService(pool, resolver)
			before := batchTagsSnapshot(t, pool)
			_, err = current.AppendOwnNotes(t.Context(), owner, input)
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			var receipts int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, input.RequestID).Scan(&receipts))
			require.Equal(t, 1, receipts)
		})
	}
}

func TestBatchNoteAppendDifferentRequestsRequireFreshVersions(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "once"})
	require.NoError(t, err)
	first := batchNoteAppendInput(preview, "once", uuid.NewString())
	second := batchNoteAppendInput(preview, "once", uuid.NewString())
	_, err = service.AppendOwnNotes(t.Context(), owner, first)
	require.NoError(t, err)
	_, err = service.AppendOwnNotes(t.Context(), owner, second)
	require.ErrorIs(t, err, shortlink.ErrTransferConflict)
	var receipts, audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1`, owner.ID).Scan(&receipts))
	require.Equal(t, 1, receipts)
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&audits))
	require.Equal(t, 3, audits)
}

// TestBatchNoteAppendRequestContentConflict pins scope, ordered IDs, exact revisions and normalized text in a committed request receipt.
func TestBatchNoteAppendRequestContentConflict(t *testing.T) {
	pool, service, admin, _, selected := batchNoteFixture(t)
	p, err := service.PreviewAdminNoteAppend(t.Context(), admin, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "once"})
	require.NoError(t, err)
	input := batchNoteAppendInput(p, "once", uuid.NewString())
	first, err := service.AppendAdminNotes(t.Context(), admin, input)
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	_, err = service.AppendOwnNotes(t.Context(), admin, input)
	require.ErrorIs(t, err, shortlink.ErrNoteAppendRequestConflict)
	for _, change := range []string{"order", "id", "main", "noteVersion", "text"} {
		altered := input
		altered.Items = append([]shortlink.BatchNoteClearItem(nil), input.Items...)
		switch change {
		case "order":
			altered.Items[0], altered.Items[1] = altered.Items[1], altered.Items[0]
		case "id":
			altered.Items[0].ID = uuid.NewString()
		case "main":
			altered.Items[0].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
		case "noteVersion":
			altered.Items[0].ExpectedNoteUpdatedAt = "2026-01-01T00:00:00Z"
		case "text":
			altered.Note = "different"
		}
		_, err = service.AppendAdminNotes(t.Context(), admin, altered)
		require.ErrorIs(t, err, shortlink.ErrNoteAppendRequestConflict, change)
		require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	}
	input.Note = " \r\nonce\t "
	replay, err := service.AppendAdminNotes(t.Context(), admin, input)
	require.NoError(t, err)
	require.Equal(t, first, replay)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
}

func TestBatchNoteAppendMissingTargetPrecedesVersionConflict(t *testing.T) {
	_, service, _, owner, selected := batchNoteFixture(t)
	preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "visible"})
	require.NoError(t, err)
	input := batchNoteAppendInput(preview, "visible", uuid.NewString())
	input.Items[1].ID = uuid.NewString()
	input.Items[1].ExpectedUpdatedAt = "2020-01-01T00:00:00Z"
	input.Items[1].ExpectedNoteUpdatedAt = "2020-01-01T00:00:00Z"
	_, err = service.AppendOwnNotes(t.Context(), owner, input)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
}

func TestBatchNoteAppendRollsBackOnAuditAndReceiptFailures(t *testing.T) {
	for _, failure := range []string{"audit", "receipt"} {
		t.Run(failure, func(t *testing.T) {
			pool, service, _, owner, selected := batchNoteFixture(t)
			preview, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "must-rollback"})
			require.NoError(t, err)
			input := batchNoteAppendInput(preview, "must-rollback", uuid.NewString())
			if failure == "audit" {
				_, err = pool.Exec(t.Context(), `create function reject_note_append_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$`)
				require.NoError(t, err)
				_, err = pool.Exec(t.Context(), `create trigger reject_note_append_audit before insert on audit_log for each row execute function reject_note_append_audit()`)
			} else {
				_, err = pool.Exec(t.Context(), `create function reject_note_append_receipt() returns trigger language plpgsql as $$ begin raise exception 'injected receipt failure'; end $$`)
				require.NoError(t, err)
				_, err = pool.Exec(t.Context(), `create trigger reject_note_append_receipt before insert on short_link_note_append_batch for each row execute function reject_note_append_receipt()`)
			}
			require.NoError(t, err)
			before := batchTagsSnapshot(t, pool)
			_, err = service.AppendOwnNotes(t.Context(), owner, input)
			require.Error(t, err)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			var receipts int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch where actor_id=$1 and request_id=$2`, owner.ID, input.RequestID).Scan(&receipts))
			require.Zero(t, receipts)
		})
	}
}
