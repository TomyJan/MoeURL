package shortlink_test

import (
	"context"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// TestBatchLockWaitRechecksAuthorizationAndTargets commits changes after the batch has reached its SQL row lock.
func TestBatchLockWaitRechecksAuthorizationAndTargets(t *testing.T) {
	for _, action := range []string{"disable", "delete"} {
		for _, mutate := range []struct {
			name, sql, waitQuery string
			expected             error
		}{
			{"permissions", `update user_group set permissions='[]' where key='user'`, "LockTargetWriterGroup", shortlink.ErrPermissionDenied},
			{"disabled actor", `update app_user set status='disabled'`, "LockTargetPolicyActor", shortlink.ErrPermissionDenied},
			{"deleted actor", `update app_user set deleted_at=now()`, "LockTargetPolicyActor", shortlink.ErrPermissionDenied},
			{"changed actor group", `with custom_group as (
				insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
				values(gen_random_uuid(),'new-group-'||gen_random_uuid()::text,'New Group '||gen_random_uuid()::text,'','[]',false,now(),now())
				returning id
			) update app_user set group_id=(select id from custom_group)`, "LockTargetPolicyActor", shortlink.ErrPermissionDenied},
			{"deleted target", `update short_link set deleted_at=now() where slug='second'`, "Batch", shortlink.ErrShortLinkMissing},
		} {
			t.Run(action+"/"+mutate.name, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
				defer cancel()
				pool := shortLinkTestPool(t, ctx)
				insertShortLinkDefaultDomain(t, ctx, pool)
				actor := insertShortLinkUser(t, ctx, pool, "actor", "user", permission.UserPermissions)
				ids := []string{insertStoredShortLink(t, ctx, pool, actor.ID, "first", "https://example.com", "active", false), insertStoredShortLink(t, ctx, pool, actor.ID, "second", "https://example.com", "active", false)}
				tx, err := pool.Begin(ctx)
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, tx.Rollback) }()
				_, err = tx.Exec(ctx, mutate.sql)
				require.NoError(t, err)
				service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
				done := make(chan error, 1)
				go func() {
					_, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: ids, Action: action})
					done <- err
				}()
				// Observe the exact authorization or target lock that serializes this mutation.
				ticker := time.NewTicker(5 * time.Millisecond)
				defer ticker.Stop()
				for {
					var waiting bool
					require.NoError(t, pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1)`, "-- name: "+mutate.waitQuery+"%").Scan(&waiting))
					if waiting {
						break
					}
					select {
					case err := <-done:
						t.Fatalf("batch completed before acquiring the expected row lock: %v", err)
					case <-ctx.Done():
						t.Fatal(ctx.Err())
					case <-ticker.C:
					}
				}
				require.NoError(t, tx.Commit(ctx))
				require.ErrorIs(t, <-done, mutate.expected)
				var intact bool
				require.NoError(t, pool.QueryRow(ctx, `select status='active' and deleted_at is null from short_link where slug='first'`).Scan(&intact))
				require.True(t, intact)
			})
		}
	}
}

// TestBatchDatabaseFailureRollsBackEveryTarget verifies statement atomicity after a late target rejects its write.
func TestBatchDatabaseFailureRollsBackEveryTarget(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "actor", "user", permission.UserPermissions)
	ids := []string{insertStoredShortLink(t, ctx, pool, actor.ID, "first", "https://example.com", "active", false), insertStoredShortLink(t, ctx, pool, actor.ID, "second", "https://example.com", "active", false)}
	_, err := pool.Exec(ctx, `create function reject_second_batch_write() returns trigger language plpgsql as $$ begin if new.slug='second' then raise exception 'forced batch failure'; end if; return new; end $$; create trigger reject_second_batch_write before update on short_link for each row execute function reject_second_batch_write()`)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	for _, action := range []string{"disable", "delete"} {
		_, err := service.Batch(ctx, actor, shortlink.BatchInput{IDs: ids, Action: action})
		require.ErrorContains(t, err, "forced batch failure")
		var intact int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where status='active' and deleted_at is null`).Scan(&intact))
		require.Equal(t, 2, intact)
	}
}
