package shortlink_test

import (
	"context"
	"encoding/json"
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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestBulkCreateStorageFailureDoesNotCommit catches database and stored-permission faults being mistaken for a valid empty batch.
func TestBulkCreateStorageFailureDoesNotCommit(t *testing.T) {
	for _, tc := range []struct {
		name, fault, restore string
		permissionJSON       bool
	}{
		{"actor read", `alter table app_user rename column status to owned_status`, `alter table app_user rename column owned_status to status`, false},
		{"group read", `alter table user_group rename column permissions to owned_permissions`, `alter table user_group rename column owned_permissions to permissions`, false},
		{"receipt read", `alter table short_link_create_batch rename column request_hash to owned_request_hash`, `alter table short_link_create_batch rename column owned_request_hash to request_hash`, false},
		{"domain grant read", `alter table domain_user_group rename column domain_id to owned_domain_id`, `alter table domain_user_group rename column owned_domain_id to domain_id`, false},
		{"corrupt permissions", `update user_group set permissions='{"invalid":"not an array"}'::jsonb where key='user'`, `update user_group set permissions='["short_link:create","domain:use_default"]'::jsonb where key='user'`, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, owner, _ := bulkCreateFixture(t)
			before := bulkCreateSnapshot(t, pool)
			_, err := pool.Exec(t.Context(), tc.fault)
			require.NoError(t, err)
			restored := false
			t.Cleanup(func() {
				if !restored {
					_, restoreErr := pool.Exec(context.Background(), tc.restore)
					require.NoError(t, restoreErr)
				}
			})
			result, createErr := service.BatchCreate(t.Context(), owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/storage-fault"}})
			_, err = pool.Exec(t.Context(), tc.restore)
			require.NoError(t, err)
			restored = true
			require.Zero(t, result)
			if tc.permissionJSON {
				var invalid *json.UnmarshalTypeError
				require.ErrorAs(t, createErr, &invalid)
			} else {
				var unavailable *pgconn.PgError
				require.ErrorAs(t, createErr, &unavailable)
				require.Equal(t, "42703", unavailable.Code)
			}
			require.Equal(t, before, bulkCreateSnapshot(t, pool), "failed reads must not commit links, audit or a replay receipt")
		})
	}
}

// TestBulkCreateCanceledDomainLock catches cancellation while domain changes hold the shared creation gate.
func TestBulkCreateCanceledDomainLock(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	gate, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = gate.Rollback(context.Background()) }()
	_, err = gate.Exec(t.Context(), `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
	require.NoError(t, err)
	before := bulkCreateSnapshot(t, pool)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() {
		result, createErr := service.BatchCreate(ctx, owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.org/canceled-lock"}})
		if result != (shortlink.BatchCreateResult{}) {
			createErr = fmt.Errorf("unexpected receipt after cancellation: %+v", result)
		}
		done <- createErr
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like 'select pg_advisory_xact_lock_shared%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond, "cancel only after the real request reaches the domain lock")
	cancel()
	require.ErrorIs(t, <-done, context.Canceled)
	require.NoError(t, gate.Rollback(t.Context()))
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
}

// bulkCreateFixture provides two real callers and an authorized default domain without preexisting links.
func bulkCreateFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003801','user','User','["short_link:create","domain:use_default"]',true,now(),now()),
        ('00000000-0000-0000-0000-000000003802','guest','Guest','[]',true,now(),now());
        insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003811','bulk-owner','Owner','00000000-0000-0000-0000-000000003801','active',false,now(),now()),
        ('00000000-0000-0000-0000-000000003812','bulk-other','Other','00000000-0000-0000-0000-000000003801','active',false,now(),now());
        insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
        ('00000000-0000-0000-0000-000000003821','https://bulk.example.com','Bulk','short_link',true,true,now(),now());
        insert into domain_user_group(domain_id,user_group_id) values
        ('00000000-0000-0000-0000-000000003821','00000000-0000-0000-0000-000000003801');`)
	require.NoError(t, err)
	owner := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000003811", Username: "bulk-owner", GroupKey: "user"}
	other := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000003812", Username: "bulk-other", GroupKey: "user"}
	return pool, shortlink.NewService(pool, permission.NewDatabaseService(pool)), owner, other
}

// bulkCreateSnapshot pins every business row, audit and idempotency receipt for rollback assertions.
func bulkCreateSnapshot(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var snapshot string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('links',(select jsonb_agg(to_jsonb(s) order by id) from short_link s),'audit',(select jsonb_agg(to_jsonb(a) order by id) from audit_log a),'receipts',(select jsonb_agg(to_jsonb(b) order by actor_id,request_id) from short_link_create_batch b))::text`).Scan(&snapshot))
	return snapshot
}

// TestBulkCreateReplayConcurrent catches duplicate commits, account collisions and content changes hidden by replay.
func TestBulkCreateReplayConcurrent(t *testing.T) {
	pool, service, owner, other := bulkCreateFixture(t)
	input := shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/bulk-first", "https://example.org/bulk-second"}}
	start := make(chan struct{})
	type outcome struct {
		result shortlink.BatchCreateResult
		err    error
	}
	outcomes := make(chan outcome, 8)
	var workers sync.WaitGroup
	for range 8 {
		workers.Add(1)
		go func() {
			defer workers.Done()
			<-start
			result, err := service.BatchCreate(t.Context(), owner, input)
			outcomes <- outcome{result, err}
		}()
	}
	close(start)
	workers.Wait()
	close(outcomes)
	for item := range outcomes {
		require.NoError(t, item.err)
		require.Equal(t, shortlink.BatchCreateResult{RequestID: input.RequestID, CreatedCount: 2}, item.result)
	}
	var links, audits, receipts int
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	require.Equal(t, []int{2, 2, 1}, []int{links, audits, receipts})
	before := bulkCreateSnapshot(t, pool)
	changed := input
	changed.TargetURLs = []string{input.TargetURLs[1], input.TargetURLs[0]}
	result, err := service.BatchCreate(t.Context(), owner, changed)
	require.ErrorIs(t, err, shortlink.ErrBulkCreateConflict)
	require.Zero(t, result)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	result, err = service.BatchCreate(t.Context(), other, changed)
	require.NoError(t, err)
	require.Equal(t, 2, result.CreatedCount)
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	require.Equal(t, []int{4, 4, 2}, []int{links, audits, receipts})
	_, err = pool.Exec(t.Context(), `update domain set enabled=false`)
	require.NoError(t, err)
	result, err = service.BatchCreate(t.Context(), owner, input)
	require.NoError(t, err, "a committed receipt does not reselect a disabled domain")
	require.Equal(t, 2, result.CreatedCount)
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:create' where key='user'`)
	require.NoError(t, err)
	_, err = service.BatchCreate(t.Context(), owner, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied, "replay cannot bypass current authorization")
}

// TestBulkCreateAtomicFailure catches a first link or audit surviving a failure later in the same batch.
func TestBulkCreateAtomicFailure(t *testing.T) {
	for _, kind := range []string{"second link", "second audit", "receipt"} {
		t.Run(kind, func(t *testing.T) {
			pool, service, owner, _ := bulkCreateFixture(t)
			var fault string
			switch kind {
			case "second link":
				fault = `alter table short_link add constraint reject_second_link check(target_url <> 'https://example.org/bulk-second') not valid`
			case "second audit":
				fault = `create function reject_second_bulk_audit() returns trigger language plpgsql as $$ begin
                    if new.resource_type='short_link' and new.action='create' and exists(select 1 from short_link where id=new.resource_id::uuid and target_url='https://example.org/bulk-second') then
                        raise exception 'owned audit fault';
                    end if; return new; end $$;
                    create trigger reject_second_bulk_audit before insert on audit_log for each row execute function reject_second_bulk_audit();`
			case "receipt":
				fault = `alter table short_link_create_batch add constraint reject_receipt check(false) not valid`
			}
			_, err := pool.Exec(t.Context(), fault)
			require.NoError(t, err)
			before := bulkCreateSnapshot(t, pool)
			result, err := service.BatchCreate(t.Context(), owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/bulk-first", "https://example.org/bulk-second"}})
			require.Error(t, err)
			require.Zero(t, result)
			require.Equal(t, before, bulkCreateSnapshot(t, pool), "business rows, audit and receipt must all roll back")
		})
	}
}

// TestBulkCreateCurrentAuthority catches trusting the request's stale group or domain authority.
func TestBulkCreateCurrentAuthority(t *testing.T) {
	for _, tc := range []struct {
		name, sql string
		want      error
	}{
		{"disabled actor", `update app_user set status='disabled' where username='bulk-owner'`, shortlink.ErrPermissionDenied},
		{"deleted actor", `update app_user set deleted_at=now() where username='bulk-owner'`, shortlink.ErrPermissionDenied},
		{"guest group", `update app_user set group_id='00000000-0000-0000-0000-000000003802' where username='bulk-owner'`, shortlink.ErrPermissionDenied},
		{"create revoked", `update user_group set permissions=permissions-'short_link:create' where key='user'`, shortlink.ErrPermissionDenied},
		{"domain permission revoked", `update user_group set permissions=permissions-'domain:use_default' where key='user'`, shortlink.ErrPermissionDenied},
		{"grant revoked", `delete from domain_user_group`, shortlink.ErrDomainUnavailable},
		{"disabled domain", `update domain set enabled=false`, shortlink.ErrDomainUnavailable},
		{"missing default", `update domain set is_default=false`, shortlink.ErrDomainUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, owner, _ := bulkCreateFixture(t)
			owner.GroupKey = "admin"
			_, err := pool.Exec(t.Context(), tc.sql)
			require.NoError(t, err)
			before := bulkCreateSnapshot(t, pool)
			result, err := service.BatchCreate(t.Context(), owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/own"}})
			require.ErrorIs(t, err, tc.want)
			require.Zero(t, result)
			require.Equal(t, before, bulkCreateSnapshot(t, pool))
		})
	}
}

// TestBulkCreateLockWaitRechecksAuthority catches permission changes committed while creation is blocked on the actor row.
func TestBulkCreateLockWaitRechecksAuthority(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(ctx, `select id from app_user where id=$1 for update`, owner.ID)
	require.NoError(t, err)
	before := bulkCreateSnapshot(t, pool)
	done := make(chan error, 1)
	go func() {
		_, err := service.BatchCreate(ctx, owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/waiting"}})
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond, "the real creation query must be waiting before revocation commits")
	_, err = tx.Exec(ctx, `update user_group set permissions=permissions-'short_link:create' where key='user'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
	require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
}

// TestBulkCreateInputBoundary catches unbounded or unsafe input before any link or receipt is written.
func TestBulkCreateInputBoundary(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	base := shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.com/valid"}}
	before := bulkCreateSnapshot(t, pool)
	for _, actor := range []auth.CurrentUser{auth.GuestUser(), {ID: "bad"}, {ID: uuid.Nil.String()}, {ID: strings.ToUpper("abcdefab-abcd-abcd-abcd-abcdefabcdef")}, {ID: uuid.NewString()}} {
		result, err := service.BatchCreate(t.Context(), actor, base)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		require.Zero(t, result)
	}
	for _, key := range []string{"", "bad", uuid.Nil.String(), strings.ToUpper("abcdefab-abcd-abcd-abcd-abcdefabcdef")} {
		invalid := base
		invalid.RequestID = key
		_, err := service.BatchCreate(t.Context(), owner, invalid)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	excessive := make([]string, 21)
	for i := range excessive {
		excessive[i] = fmt.Sprintf("https://example.com/%d", i)
	}
	for _, targets := range [][]string{nil, {}, excessive, {""}, {base.TargetURLs[0], base.TargetURLs[0]}, {"https://example.com/has space"}, {"https://example.com/中文"}, {"https://example.com/" + strings.Repeat("a", 2049-len("https://example.com/"))}} {
		invalid := base
		invalid.TargetURLs = targets
		_, err := service.BatchCreate(t.Context(), owner, invalid)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput, targets)
	}
	for _, target := range []string{"ftp://example.com/file", "https://localhost/x", "https://127.0.0.1/x", "http://10.0.0.1/x", "//example.com/x", "https:///missing"} {
		invalid := base
		invalid.TargetURLs = []string{target}
		_, err := service.BatchCreate(t.Context(), owner, invalid)
		require.ErrorIs(t, err, shortlink.ErrInvalidTargetURL, target)
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := service.BatchCreate(ctx, owner, base)
	require.ErrorIs(t, err, context.Canceled)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	for _, count := range []int{1, 20} {
		targets := make([]string, count)
		for i := range targets {
			targets[i] = fmt.Sprintf("https://example.com/limit-%d-%d", count, i)
		}
		targets[0] = "https://example.com/" + strings.Repeat("a", 2048-len("https://example.com/"))
		result, err := service.BatchCreate(t.Context(), owner, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: targets})
		require.NoError(t, err)
		require.Equal(t, count, result.CreatedCount)
	}
}
