package shortlink_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// transferFixture provides real accounts, history and a link with a precise version.
func transferFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, auth.CurrentUser, shortlink.TransferInput) {
	t.Helper()
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "manager", "admin", permission.AdminPermissions)
	groupID := uuid.NewString()
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User',$2::jsonb,true,now(),now())`, groupID, permissionsJSON(t, permission.UserPermissions))
	require.NoError(t, err)
	owner := insertShortLinkUserForGroup(t, ctx, pool, "original", groupID, uuid.NewString(), "user", permission.UserPermissions)
	recipient := insertShortLinkUserForGroup(t, ctx, pool, "recipient", groupID, uuid.NewString(), "user", permission.UserPermissions)
	id := insertStoredShortLink(t, ctx, pool, owner.ID, "handoff", "https://example.com/long?q=1", "disabled", false)
	_, err = pool.Exec(ctx, `update short_link set title='Keep title',tags=array['keep'],redirect_mode='confirmation',max_visits=10,visits_used=3,expires_at=now()+interval '1 day',password_hash='private-password-hash',password_updated_at=now(),updated_at='2026-10-23T00:00:00.123456Z' where id=$1`, id)
	require.NoError(t, err)
	insertStoredShortLinkVisitEvent(t, ctx, pool, id)
	return pool, shortlink.NewService(pool, permission.NewDatabaseService(pool)), actor, owner, recipient, shortlink.TransferInput{ID: id, NewOwnerUsername: recipient.Username, ExpectedUpdatedAt: "2026-10-23T00:00:00.123456Z"}
}

// TestTransfer verifies stable public data, current ownership boundaries and atomic audit.
func TestTransfer(t *testing.T) {
	pool, service, actor, owner, recipient, input := transferFixture(t)
	ctx := t.Context()
	var before, after string
	require.NoError(t, pool.QueryRow(ctx, `select (to_jsonb(short_link)-'owner_id'-'updated_at')::text from short_link where id=$1`, input.ID).Scan(&before))
	listed, err := service.AdminList(ctx, actor, shortlink.ListInput{})
	require.NoError(t, err)
	require.Equal(t, input.ExpectedUpdatedAt, listed.Items[0].UpdatedAt.UTC().Format(time.RFC3339Nano))
	result, err := service.Transfer(ctx, actor, input)
	require.NoError(t, err)
	require.Equal(t, input.ID, result.ID)
	require.Equal(t, recipient.ID, result.OwnerID)
	require.NotEqual(t, input.ExpectedUpdatedAt, result.UpdatedAt)
	require.NoError(t, pool.QueryRow(ctx, `select (to_jsonb(short_link)-'owner_id'-'updated_at')::text from short_link where id=$1`, input.ID).Scan(&after))
	require.JSONEq(t, before, after)
	oldList, err := service.List(ctx, owner, shortlink.ListInput{})
	require.NoError(t, err)
	require.Empty(t, oldList.Items)
	newList, err := service.List(ctx, recipient, shortlink.ListInput{})
	require.NoError(t, err)
	require.Len(t, newList.Items, 1)
	require.Equal(t, int64(1), newList.Items[0].Stats.VisitCount)
	_, err = service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: input.ID})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	stats, err := service.Statistics(ctx, recipient, shortlink.StatisticsInput{ID: input.ID})
	require.NoError(t, err)
	require.Equal(t, int64(1), stats.Stats.VisitCount)
	_, err = service.Update(ctx, owner, shortlink.UpdateInput{ID: input.ID, Status: ptr("active")})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	require.ErrorIs(t, service.Delete(ctx, owner, shortlink.DeleteInput{ID: input.ID}), shortlink.ErrShortLinkMissing)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and actor_id=$2 and changed_fields=array['owner_id']`, input.ID, actor.ID).Scan(&count))
	require.Equal(t, 1, count)
	_, err = service.Transfer(ctx, actor, input)
	require.ErrorIs(t, err, shortlink.ErrTransferConflict)
	input.ExpectedUpdatedAt = result.UpdatedAt
	noop, err := service.Transfer(ctx, actor, input)
	require.NoError(t, err)
	require.Equal(t, result, noop)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1`, input.ID).Scan(&count))
	require.Equal(t, 1, count)
	_, err = service.Update(ctx, recipient, shortlink.UpdateInput{ID: input.ID, Status: ptr("active")})
	require.NoError(t, err)
}

// TestTransferExistingRecipientUsernames preserves the account-creation contract and exact lookup.
func TestTransferExistingRecipientUsernames(t *testing.T) {
	for _, username := range []string{strings.Repeat("中", 22), strings.Repeat("a", 70), " recipient "} {
		t.Run(username, func(t *testing.T) {
			pool, service, actor, _, _, input := transferFixture(t)
			created, err := user.NewService(pool, permission.NewDatabaseService(pool)).Create(t.Context(), actor, user.CreateInput{
				Username: username, Password: "recipient-password", Nickname: "Recipient", GroupKey: "user", Status: "active",
			})
			require.NoError(t, err)
			require.Equal(t, username, created.User.Username)
			input.NewOwnerUsername = username
			result, err := service.Transfer(t.Context(), actor, input)
			require.NoError(t, err)
			require.Equal(t, created.User.ID, result.OwnerID)
			var stored string
			require.NoError(t, pool.QueryRow(t.Context(), `select owner_id::text from short_link where id=$1`, input.ID).Scan(&stored))
			require.Equal(t, created.User.ID, stored)
		})
	}
}

// TestTransferGuards rejects stale roles, invalid receivers, malformed input and deleted links.
func TestTransferGuards(t *testing.T) {
	pool, service, actor, owner, recipient, input := transferFixture(t)
	for _, mutate := range []func(*shortlink.TransferInput){
		func(v *shortlink.TransferInput) { v.ID = "bad" },
		func(v *shortlink.TransferInput) { v.ID = uuid.Nil.String() },
		func(v *shortlink.TransferInput) { v.ExpectedUpdatedAt = "bad" },
		func(v *shortlink.TransferInput) { v.ExpectedUpdatedAt = "0001-01-01T00:00:00Z" },
		func(v *shortlink.TransferInput) { v.NewOwnerUsername = "" },
	} {
		bad := input
		mutate(&bad)
		_, err := service.Transfer(t.Context(), actor, bad)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	for _, identity := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad", GroupKey: "admin"}, {ID: uuid.Nil.String(), GroupKey: "admin"}, {ID: uuid.NewString(), GroupKey: "admin"}, {ID: owner.ID, GroupKey: "admin"}} {
		_, err := service.Transfer(t.Context(), identity, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	for _, sql := range []string{`update app_user set status='disabled' where id=$1`, `update app_user set status='active',deleted_at=now() where id=$1`} {
		_, err := pool.Exec(t.Context(), sql, recipient.ID)
		require.NoError(t, err)
		_, err = service.Transfer(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrTransferRecipientUnavailable)
	}
	_, err := pool.Exec(t.Context(), `update app_user set deleted_at=null,status='active' where id=$1;`, recipient.ID)
	require.NoError(t, err)
	bad := input
	bad.NewOwnerUsername = "missing"
	_, err = service.Transfer(t.Context(), actor, bad)
	require.ErrorIs(t, err, shortlink.ErrTransferRecipientUnavailable)
	bad.ID = uuid.NewString()
	bad.NewOwnerUsername = recipient.Username
	_, err = service.Transfer(t.Context(), actor, bad)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, input.ID)
	require.NoError(t, err)
	_, err = service.Transfer(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
}

// TestTransferCurrentDatabaseState refuses stale actor roles and unavailable recipient groups.
func TestTransferCurrentDatabaseState(t *testing.T) {
	for _, tc := range []struct {
		name, sql string
		expected  error
	}{
		{"disabled actor", `update app_user set status='disabled' where username='manager'`, shortlink.ErrPermissionDenied},
		{"deleted actor", `update app_user set deleted_at=now() where username='manager'`, shortlink.ErrPermissionDenied},
		{"demoted actor", `update app_user set group_id=(select id from user_group where key='user') where username='manager'`, shortlink.ErrPermissionDenied},
		{"missing admin access", `update user_group set permissions=permissions-'admin:access' where key='admin'`, shortlink.ErrPermissionDenied},
		{"missing update all", `update user_group set permissions=permissions-'short_link:update_all' where key='admin'`, shortlink.ErrPermissionDenied},
		{"malformed permissions", `update user_group set permissions='{}' where key='admin'`, nil},
		{"unsupported recipient group", `update user_group set key='guest' where key='user'`, shortlink.ErrTransferRecipientUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor, _, _, input := transferFixture(t)
			_, err := pool.Exec(t.Context(), tc.sql)
			require.NoError(t, err)
			_, err = shortlink.NewService(pool, permission.NewService()).Transfer(t.Context(), actor, input)
			if tc.expected != nil {
				require.ErrorIs(t, err, tc.expected)
			} else {
				require.Error(t, err)
			}
		})
	}
}

// TestTransferOwnWriteWait rechecks ownership after an old owner's write waits for a handoff lock.
func TestTransferOwnWriteWait(t *testing.T) {
	for _, action := range []string{"update", "delete"} {
		t.Run(action, func(t *testing.T) {
			pool, service, _, owner, recipient, input := transferFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = tx.Rollback(context.Background()) }()
			_, err = tx.Exec(ctx, `update short_link set owner_id=$2 where id=$1`, input.ID, recipient.ID)
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() {
				if action == "update" {
					_, err := service.Update(ctx, owner, shortlink.UpdateInput{ID: input.ID, Status: ptr("active")})
					done <- err
				} else {
					done <- service.Delete(ctx, owner, shortlink.DeleteInput{ID: input.ID})
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
				case err := <-done:
					t.Fatalf("write completed before lock wait: %v", err)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-ticker.C:
				}
			}
			require.NoError(t, tx.Commit(ctx))
			require.ErrorIs(t, <-done, shortlink.ErrShortLinkMissing)
			var intact bool
			require.NoError(t, pool.QueryRow(ctx, `select status='disabled' and deleted_at is null from short_link where id=$1`, input.ID).Scan(&intact))
			require.True(t, intact)
		})
	}
}

// TestTransferConcurrentVersion prevents two requests from silently handing off the same version.
func TestTransferConcurrentVersion(t *testing.T) {
	_, service, actor, _, _, input := transferFixture(t)
	start := make(chan struct{})
	done := make(chan error, 2)
	var workers sync.WaitGroup
	for _, username := range []string{input.NewOwnerUsername, actor.Username} {
		request := input
		request.NewOwnerUsername = username
		workers.Go(func() { <-start; _, err := service.Transfer(t.Context(), actor, request); done <- err })
	}
	close(start)
	workers.Wait()
	close(done)
	success := 0
	for err := range done {
		if err == nil {
			success++
		} else {
			require.ErrorIs(t, err, shortlink.ErrTransferConflict)
		}
	}
	require.Equal(t, 1, success)
}

// TestTransferWaitsForUserChanges proves locked account changes are rechecked after waiting.
func TestTransferWaitsForUserChanges(t *testing.T) {
	for _, tc := range []struct {
		name, username, change string
		expected               error
	}{
		{"actor disabled", "manager", "status='disabled'", shortlink.ErrPermissionDenied},
		{"actor demoted", "manager", "group_id=(select id from user_group where key='user')", shortlink.ErrPermissionDenied},
		{"recipient disabled", "recipient", "status='disabled'", shortlink.ErrTransferRecipientUnavailable},
		{"recipient changed to guest", "recipient", "group_id=(select id from user_group where key='guest')", shortlink.ErrTransferRecipientUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, _, actor, owner, _, input := transferFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'guest','Guest','[]',true,now(),now())`, uuid.NewString())
			require.NoError(t, err)
			tx, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = tx.Rollback(context.Background()) }()
			_, err = tx.Exec(ctx, `update app_user set `+tc.change+` where username=$1`, tc.username)
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() {
				_, err := shortlink.NewService(pool, permission.NewService()).Transfer(ctx, actor, input)
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
					t.Fatalf("transfer completed before lock wait: %v", err)
				case <-ctx.Done():
					t.Fatal(ctx.Err())
				case <-ticker.C:
				}
			}
			require.NoError(t, tx.Commit(ctx))
			require.ErrorIs(t, <-done, tc.expected)
			var stored string
			require.NoError(t, pool.QueryRow(ctx, `select owner_id::text from short_link where id=$1`, input.ID).Scan(&stored))
			require.Equal(t, owner.ID, stored)
			var audits int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
}

type transferFaultTracer struct{ prefix string }

// TraceQueryStart cancels a real database request at a controlled transaction boundary.
func (tr transferFaultTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.HasPrefix(data.SQL, tr.prefix) {
		ctx, cancel := context.WithCancel(ctx)
		cancel()
		return ctx
	}
	return ctx
}

// TraceQueryEnd preserves the actual driver's result.
func (transferFaultTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// TestTransferRollback verifies failed writes and audit inserts never leave partial ownership changes.
func TestTransferRollback(t *testing.T) {
	pool, _, actor, owner, _, input := transferFixture(t)
	for _, prefix := range []string{"begin", "-- name: LockTransferUsers", "-- name: LockTransferActorGroup", "-- name: LockTransferShortLink", "-- name: TransferShortLinkOwner", "commit"} {
		t.Run(prefix, func(t *testing.T) {
			config := pool.Config()
			config.ConnConfig.Tracer = transferFaultTracer{prefix}
			faulty, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(faulty.Close)
			_, err = shortlink.NewService(faulty, permission.NewDatabaseService(faulty)).Transfer(t.Context(), actor, input)
			require.Error(t, err)
		})
	}
	_, err := pool.Exec(t.Context(), `alter table audit_log add constraint reject_transfer check(false) not valid`)
	require.NoError(t, err)
	_, err = shortlink.NewService(pool, permission.NewDatabaseService(pool)).Transfer(t.Context(), actor, input)
	require.Error(t, err)
	var stored string
	require.NoError(t, pool.QueryRow(t.Context(), `select owner_id::text from short_link where id=$1`, input.ID).Scan(&stored))
	require.Equal(t, owner.ID, stored)
	var audits int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
	require.Zero(t, audits)
}
