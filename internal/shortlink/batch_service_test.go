package shortlink_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBatchActionsAreAtomicAndPreserveUnrelatedFields exercises actual PostgreSQL writes in both scopes.
func TestBatchActionsAreAtomicAndPreserveUnrelatedFields(t *testing.T) {
	for _, admin := range []bool{false, true} {
		for _, action := range []string{"enable", "disable", "delete"} {
			t.Run(fmt.Sprintf("admin=%t/%s", admin, action), func(t *testing.T) {
				ctx := context.Background()
				pool := shortLinkTestPool(t, ctx)
				insertShortLinkDefaultDomain(t, ctx, pool)
				group, permissions := permission.GroupUser, permission.UserPermissions
				if admin {
					group, permissions = permission.GroupAdmin, permission.AdminPermissions
				}
				actor := insertShortLinkUser(t, ctx, pool, "actor", group, permissions)
				other := insertShortLinkUserForGroup(t, ctx, pool, "other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), group, permissions)
				owner := actor.ID
				if admin {
					owner = other.ID
				}
				ids := []string{insertStoredShortLink(t, ctx, pool, owner, "batcha", "https://example.com/a", "active", false), insertStoredShortLink(t, ctx, pool, owner, "batchb", "https://example.com/b", "disabled", false)}
				_, err := pool.Exec(ctx, `update short_link set title='keep', tags=array['keep'], max_visits=9, visits_used=3, password_hash='keep', password_updated_at=now(), expires_at=now()+interval '1 day', redirect_mode='confirmation' where id=any($1::uuid[])`, ids)
				require.NoError(t, err)
				insertStoredShortLinkVisitEvent(t, ctx, pool, ids[0])
				var before, after string
				const unrelated = `select jsonb_agg(to_jsonb(s) - 'status' - 'updated_at' - 'deleted_at' order by id)::text from short_link s where id=any($1::uuid[])`
				require.NoError(t, pool.QueryRow(ctx, unrelated, ids).Scan(&before))
				service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
				run := service.Batch
				if admin {
					run = service.AdminBatch
				}
				result, err := run(ctx, actor, shortlink.BatchInput{IDs: ids, Action: action})
				require.NoError(t, err)
				require.Equal(t, int64(2), result.AffectedCount)
				require.NoError(t, pool.QueryRow(ctx, unrelated, ids).Scan(&after))
				require.Equal(t, before, after)
				var count int
				predicate := "status='active' and deleted_at is null"
				if action == "disable" {
					predicate = "status='disabled' and deleted_at is null"
				}
				if action == "delete" {
					predicate = "deleted_at is not null"
					var statuses []string
					require.NoError(t, pool.QueryRow(ctx, `select array_agg(status order by slug) from short_link where id=any($1::uuid[])`, ids).Scan(&statuses))
					require.Equal(t, []string{"active", "disabled"}, statuses)
				}
				require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where id=any($1::uuid[]) and `+predicate, ids).Scan(&count))
				require.Equal(t, 2, count)
				var events int
				require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link_event`).Scan(&events))
				require.Equal(t, 1, events)
			})
		}
	}
}

// TestBatchRejectsInvalidTargetsWithoutPartialWrites verifies missing, deleted and foreign records remain private.
func TestBatchRejectsInvalidTargetsWithoutPartialWrites(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "actor", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "other", "00000000-0000-0000-0000-000000000401", uuid.NewString(), "user", permission.UserPermissions)
	id := insertStoredShortLink(t, ctx, pool, actor.ID, "valid", "https://example.com", "active", false)
	foreign := insertStoredShortLink(t, ctx, pool, other.ID, "foreign", "https://example.com", "active", false)
	deleted := insertStoredShortLink(t, ctx, pool, actor.ID, "deleted", "https://example.com", "active", true)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	for _, invalid := range []string{foreign, deleted, uuid.NewString()} {
		for _, action := range []string{"enable", "disable", "delete"} {
			_, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: []string{id, invalid}, Action: action})
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			var status string
			var intact bool
			require.NoError(t, pool.QueryRow(ctx, `select status, deleted_at is null from short_link where id=$1`, id).Scan(&status, &intact))
			require.Equal(t, "active", status)
			require.True(t, intact)
		}
	}
}

// TestBatchRechecksDatabaseAuthorization rejects static permission snapshots after database revocation.
func TestBatchRechecksDatabaseAuthorization(t *testing.T) {
	for _, mutate := range []string{"update user_group set permissions='[]'", "update app_user set status='disabled'", "update app_user set deleted_at=now()", "update user_group set key='changed'"} {
		t.Run(mutate, func(t *testing.T) {
			ctx := context.Background()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "actor", "admin", permission.AdminPermissions)
			id := insertStoredShortLink(t, ctx, pool, actor.ID, "batch", "https://example.com", "active", false)
			_, err := pool.Exec(ctx, mutate)
			require.NoError(t, err)
			service := shortlink.NewService(pool, permission.NewService())
			for _, run := range []func(context.Context, auth.CurrentUser, shortlink.BatchInput) (shortlink.BatchResult, error){service.Batch, service.AdminBatch} {
				for _, action := range []string{"enable", "disable", "delete"} {
					_, err := run(ctx, actor, shortlink.BatchInput{IDs: []string{id}, Action: action})
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				}
			}
			var intact bool
			require.NoError(t, pool.QueryRow(ctx, `select status='active' and deleted_at is null from short_link where id=$1`, id).Scan(&intact))
			require.True(t, intact)
		})
	}
}

// TestBatchInputBoundsAndPermissions checks the public service boundary, including canonical UUID duplicates.
func TestBatchInputBoundsAndPermissions(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "actor", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	ids := make([]string, 100)
	for i := range ids {
		ids[i] = insertStoredShortLink(t, ctx, pool, actor.ID, fmt.Sprintf("bulk%d", i), "https://example.com", "active", false)
	}
	for _, n := range []int{1, 100} {
		result, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: ids[:n], Action: "enable"})
		require.NoError(t, err)
		require.Equal(t, int64(n), result.AffectedCount)
	}
	for _, input := range []shortlink.BatchInput{
		{Action: "disable"}, {IDs: []string{}, Action: "disable"}, {IDs: append(append([]string{}, ids...), uuid.NewString()), Action: "disable"},
		{IDs: []string{ids[0], strings.ReplaceAll(ids[0], "-", "")}, Action: "disable"}, {IDs: []string{uuid.Nil.String()}, Action: "disable"}, {IDs: []string{"bad"}, Action: "disable"}, {IDs: ids[:1], Action: "unknown"},
	} {
		_, err := service.Batch(ctx, actor, input)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	actor.ID = "bad"
	_, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: ids[:1], Action: "disable"})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	_, err = service.AdminBatch(ctx, actor, shortlink.BatchInput{IDs: ids[:1], Action: "disable"})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = service.Batch(ctx, auth.GuestUser(), shortlink.BatchInput{IDs: ids[:1], Action: "delete"})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	pool.Close()
	_, err = shortlink.NewService(pool, permission.NewService()).Batch(ctx, auth.CurrentUser{ID: uuid.NewString(), GroupKey: "user"}, shortlink.BatchInput{IDs: ids[:1], Action: "enable"})
	require.Error(t, err)
	require.False(t, errors.Is(err, shortlink.ErrPermissionDenied))
}

// TestBatchReverseConcurrentOrderCompletes verifies all batches lock records in the same order.
func TestBatchReverseConcurrentOrderCompletes(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "actor", "user", permission.UserPermissions)
	ids := []string{insertStoredShortLink(t, ctx, pool, actor.ID, "first", "https://example.com", "active", false), insertStoredShortLink(t, ctx, pool, actor.ID, "second", "https://example.com", "active", false)}
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	start := make(chan struct{})
	done := make(chan error, 20)
	for i := range 20 {
		go func() {
			<-start
			batch, action := ids, "enable"
			if i%2 == 1 {
				batch, action = []string{ids[1], ids[0]}, "disable"
			}
			_, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: batch, Action: action})
			done <- err
		}()
	}
	close(start)
	for range 20 {
		require.NoError(t, <-done)
	}
	var states int
	require.NoError(t, pool.QueryRow(ctx, `select count(distinct status) from short_link where id=any($1::uuid[])`, ids).Scan(&states))
	require.Equal(t, 1, states)
}
