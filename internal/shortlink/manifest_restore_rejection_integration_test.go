package shortlink_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/createquota"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRestoreManifestRejectsWithoutSideEffects catches trusting the entry actor's
// stale grants or committing any links, audit, quota, or receipt on rejection.
func TestRestoreManifestRejectsWithoutSideEffects(t *testing.T) {
	for _, test := range []struct {
		name       string
		mutation   string
		permission string
		changeLast func(*shortlink.ManifestRestoreItem)
		count      int
		want       error
	}{
		{name: "disabled_actor", mutation: `update app_user set status='disabled'`, want: shortlink.ErrPermissionDenied},
		{name: "deleted_actor", mutation: `update app_user set deleted_at=now()`, want: shortlink.ErrPermissionDenied},
		{name: "moved_to_guest", mutation: `with guest_group as (
			insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
			values(gen_random_uuid(),'guest','Guest','','[]',true,now(),now()) returning id
		) update app_user set group_id=(select id from guest_group)`, want: shortlink.ErrPermissionDenied},
		{name: "create_revoked", permission: permission.ShortLinkCreate, want: shortlink.ErrPermissionDenied},
		{name: "custom_slug_revoked", permission: permission.ShortLinkCustomSlug, want: shortlink.ErrPermissionDenied},
		{name: "empty_metadata_revoked", permission: permission.ShortLinkSetMetadata, want: shortlink.ErrPermissionDenied},
		{name: "disabled_without_update", permission: permission.ShortLinkUpdateOwn, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.Status = "disabled"
		}, want: shortlink.ErrPermissionDenied},
		{name: "intermediate_revoked", permission: permission.ShortLinkUseIntermediate, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.RedirectMode, item.IntermediateDelaySeconds = "intermediate", "7"
		}, want: shortlink.ErrPermissionDenied},
		{name: "confirmation_revoked", permission: permission.ShortLinkUseConfirmation, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.RedirectMode = "confirmation"
		}, want: shortlink.ErrPermissionDenied},
		{name: "expiration_revoked", permission: permission.ShortLinkSetExpiration, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.ExpiresAt = "2099-01-01T00:00:00Z"
		}, want: shortlink.ErrPermissionDenied},
		{name: "visit_limit_revoked", permission: permission.ShortLinkSetMaxVisits, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.MaxVisits = "1"
		}, want: shortlink.ErrPermissionDenied},
		{name: "default_permission_revoked", permission: permission.DomainUseDefault, want: shortlink.ErrDomainUnavailable},
		{name: "assigned_permission_revoked", permission: permission.DomainUseAssigned, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.DomainOrigin = "https://assigned.example.com"
		}, want: shortlink.ErrDomainUnavailable},
		{name: "default_grant_revoked", mutation: `delete from domain_user_group where domain_id='00000000-0000-0000-0000-000000000301'`, want: shortlink.ErrDomainUnavailable},
		{name: "assigned_grant_revoked", mutation: `delete from domain_user_group where domain_id='00000000-0000-0000-0000-000000000302'`, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.DomainOrigin = "https://assigned.example.com"
		}, want: shortlink.ErrDomainUnavailable},
		{name: "assigned_domain_disabled", mutation: `update domain set enabled=false where id='00000000-0000-0000-0000-000000000302'`, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.DomainOrigin = "https://assigned.example.com"
		}, want: shortlink.ErrDomainUnavailable},
		{name: "default_domain_disabled", mutation: `update domain set enabled=false where id='00000000-0000-0000-0000-000000000301'`, want: shortlink.ErrDomainUnavailable},
		{name: "assigned_domain_deleted", mutation: `delete from domain where id='00000000-0000-0000-0000-000000000302'`, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.DomainOrigin = "https://assigned.example.com"
		}, want: shortlink.ErrDomainUnavailable},
		{name: "target_denied", mutation: `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.TargetURL = "https://blocked.example/private"
		}, want: targetpolicy.ErrTargetDenied},
		{name: "later_quota_chunk_exhausted", count: 21, mutation: `update system_setting set value='{"dailyLimit":20}' where key='security.account_daily_create_quota'`, want: createquota.ErrExhausted},
		{name: "expired_after_quota_consumption", count: 21, changeLast: func(item *shortlink.ManifestRestoreItem) {
			item.ExpiresAt = "2000-01-01T00:00:00Z"
		}, want: shortlink.ErrInvalidExpiration},
		{name: "soft_deleted_slug_occupied", mutation: `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at,deleted_at)
			values(gen_random_uuid(),'00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000301','restorecheck001','https://target.example/existing','active',now(),now(),now())`, want: shortlink.ErrSlugConflict},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "restore-check", permission.GroupUser, permission.UserPermissions)
			if _, err := pool.Exec(ctx, `
				insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
				values('00000000-0000-0000-0000-000000000302','https://assigned.example.com','Assigned','short_link',true,false,now(),now());
				insert into domain_user_group(domain_id,user_group_id)
				values('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000401')
			`); err != nil {
				t.Fatalf("seed assigned domain: %v", err)
			}
			input := manifestRestoreStorageInput(2)
			if test.count != 0 {
				input = manifestRestoreStorageInput(test.count)
			}
			if test.changeLast != nil {
				test.changeLast(&input.Items[len(input.Items)-1])
			}
			// Keep the captured actor unchanged, then mutate authoritative storage.
			if test.permission != "" {
				if _, err := pool.Exec(ctx, `update user_group set permissions=permissions-$1::text where key='user'`, test.permission); err != nil {
					t.Fatalf("revoke stored permission: %v", err)
				}
			}
			if test.mutation != "" {
				if _, err := pool.Exec(ctx, test.mutation); err != nil {
					t.Fatalf("arrange rejection: %v", err)
				}
			}
			before := manifestRestoreStorageSnapshot(t, ctx, pool)
			service := shortlink.NewService(pool, permission.NewService())
			for attempt := 0; attempt < 2; attempt++ {
				result, err := service.RestoreManifest(ctx, actor, input)
				if !errors.Is(err, test.want) || result.CreatedCount != 0 || result.RequestID != "" {
					t.Fatalf("attempt %d: result=%#v error=%v, want %v and empty receipt", attempt, result, err, test.want)
				}
				if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != before {
					t.Fatalf("attempt %d: rejected restore changed persisted links, events, audit, quota, or receipts", attempt)
				}
			}
		})
	}
}

// TestRestoreManifestHundredRowsAtQuotaBoundary catches partial chunk accounting,
// replay consuming quota again, and restores that silently reject valid 100-row files.
func TestRestoreManifestHundredRowsAtQuotaBoundary(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "restore-hundred", permission.GroupUser, permission.UserPermissions)
	if _, err := pool.Exec(ctx, `update system_setting set value='{"dailyLimit":100}' where key='security.account_daily_create_quota'`); err != nil {
		t.Fatal(err)
	}
	service := shortlink.NewService(pool, permission.NewService())
	input := manifestRestoreStorageInput(100)
	result, err := service.RestoreManifest(ctx, actor, input)
	if err != nil || result.CreatedCount != 100 || result.RequestID != input.RequestID {
		t.Fatalf("100-row restore = %#v, %v", result, err)
	}
	var links, audits, receipts, events, usage int
	if err := pool.QueryRow(ctx, `select
		(select count(*) from short_link where owner_id=$1::uuid and status='active' and visits_used=0 and password_hash is null),
		(select count(*) from audit_log where actor_id=$1::uuid and resource_type='short_link' and action='create'),
		(select count(*) from short_link_create_batch where actor_id=$1::uuid and request_id=$2::uuid and created_count=100),
		(select count(*) from short_link_event),
		(select used from account_daily_create_usage where actor_id=$1::uuid)
	`, actor.ID, input.RequestID).Scan(&links, &audits, &receipts, &events, &usage); err != nil {
		t.Fatal(err)
	}
	if links != 100 || audits != 100 || receipts != 1 || events != 0 || usage != 100 {
		t.Fatalf("100-row state: links=%d audits=%d receipts=%d events=%d quota=%d", links, audits, receipts, events, usage)
	}
	before := manifestRestoreStorageSnapshot(t, ctx, pool)
	replayed, err := service.RestoreManifest(ctx, actor, input)
	if err != nil || replayed != result {
		t.Fatalf("100-row replay = %#v, %v; want %#v", replayed, err, result)
	}
	if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != before {
		t.Fatal("100-row replay changed persisted state")
	}
	next := manifestRestoreStorageInput(1)
	next.Items[0].Slug = "restoreafterlimit"
	if _, err := service.RestoreManifest(ctx, actor, next); !errors.Is(err, createquota.ErrExhausted) {
		t.Fatalf("restore beyond quota = %v, want quota exhausted", err)
	}
	if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != before {
		t.Fatal("quota rejection after successful 100-row restore changed persisted state")
	}
}

func manifestRestoreStorageInput(count int) shortlink.ManifestRestoreInput {
	input := shortlink.ManifestRestoreInput{RequestID: uuid.NewString(), Items: make([]shortlink.ManifestRestoreItem, count)}
	for i := range input.Items {
		input.Items[i] = shortlink.ManifestRestoreItem{
			DomainOrigin: "https://go.example.com", Slug: fmt.Sprintf("restorecheck%03d", i),
			TargetURL: fmt.Sprintf("https://target.example/restore/%d", i), Tags: []string{},
			Status: "active", RedirectMode: "direct", IntermediateDelaySeconds: "5",
		}
	}
	return input
}

// Snapshot complete rows, including absent usage rows, to catch compensating
// deletes, partial quota consumption, and hidden changes on an idempotent replay.
func manifestRestoreStorageSnapshot(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var snapshot string
	if err := pool.QueryRow(ctx, `select jsonb_build_object(
		'links', (select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from short_link s),
		'events', (select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') from short_link_event e),
		'audit', (select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_log a),
		'quota', (select coalesce(jsonb_agg(to_jsonb(q) order by actor_id),'[]') from account_daily_create_usage q),
		'receipts', (select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,request_id),'[]') from short_link_create_batch r)
	)::text`).Scan(&snapshot); err != nil {
		t.Fatalf("snapshot restore side effects: %v", err)
	}
	return snapshot
}

// TestRestoreManifestWriteFailuresRollbackAndAllowRetry catches partial writes
// and burned idempotency keys when storage fails after quota or earlier rows.
func TestRestoreManifestWriteFailuresRollbackAndAllowRetry(t *testing.T) {
	for _, fault := range []struct {
		name, install, remove, constraint string
	}{
		{
			name: "late_link_constraint",
			install: `alter table short_link add constraint manifest_test_link_guard
				check (slug <> 'restorecheck020')`,
			remove:     `alter table short_link drop constraint manifest_test_link_guard`,
			constraint: "manifest_test_link_guard",
		},
		{
			name: "late_audit_insert",
			install: `create function manifest_test_fail_audit() returns trigger language plpgsql as $$
				begin
					if new.resource_type='short_link' and new.action='create' and exists (
						select 1 from short_link where id::text=new.resource_id and slug='restorecheck020'
					) then
						raise exception 'injected restore audit failure'
							using errcode='23514', constraint='manifest_test_audit_guard';
					end if;
					return new;
				end $$;
				create trigger manifest_test_audit_guard before insert on audit_log
				for each row execute function manifest_test_fail_audit()`,
			remove: `drop trigger manifest_test_audit_guard on audit_log;
				drop function manifest_test_fail_audit()`,
			constraint: "manifest_test_audit_guard",
		},
		{
			name: "final_receipt_insert",
			install: `alter table short_link_create_batch add constraint manifest_test_receipt_guard
				check (created_count <= 20)`,
			remove:     `alter table short_link_create_batch drop constraint manifest_test_receipt_guard`,
			constraint: "manifest_test_receipt_guard",
		},
	} {
		t.Run(fault.name, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "restore-storage-failure", permission.GroupUser, permission.UserPermissions)
			if _, err := pool.Exec(ctx, fault.install); err != nil {
				t.Fatalf("install isolated storage fault: %v", err)
			}
			service := shortlink.NewService(pool, permission.NewService())
			input := manifestRestoreStorageInput(21)
			before := manifestRestoreStorageSnapshot(t, ctx, pool)
			for attempt := 0; attempt < 2; attempt++ {
				result, err := service.RestoreManifest(ctx, actor, input)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != "23514" || pgErr.ConstraintName != fault.constraint || result != (shortlink.BatchCreateResult{}) {
					t.Fatalf("attempt %d: result=%#v err=%v; want injected constraint %s and no receipt", attempt, result, err, fault.constraint)
				}
				if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != before {
					t.Fatalf("attempt %d: failed write left persisted restore data", attempt)
				}
			}
			if _, err := pool.Exec(ctx, fault.remove); err != nil {
				t.Fatalf("remove isolated storage fault: %v", err)
			}
			result, err := service.RestoreManifest(ctx, actor, input)
			if err != nil || result.RequestID != input.RequestID || result.CreatedCount != 21 {
				t.Fatalf("retry after storage recovery = %#v, %v", result, err)
			}
			var links, audits, receipts, usage int
			if err := pool.QueryRow(ctx, `select
				(select count(*) from short_link),
				(select count(*) from audit_log where actor_id=$1::uuid and resource_type='short_link' and action='create'),
				(select count(*) from short_link_create_batch where actor_id=$1::uuid and request_id=$2::uuid and created_count=21),
				(select used from account_daily_create_usage where actor_id=$1::uuid)
			`, actor.ID, input.RequestID).Scan(&links, &audits, &receipts, &usage); err != nil {
				t.Fatal(err)
			}
			if links != 21 || audits != 21 || receipts != 1 || usage != 21 {
				t.Fatalf("recovered state: links=%d audit=%d receipts=%d quota=%d", links, audits, receipts, usage)
			}
			recovered := manifestRestoreStorageSnapshot(t, ctx, pool)
			replayed, err := service.RestoreManifest(ctx, actor, input)
			if err != nil || replayed != result || manifestRestoreStorageSnapshot(t, ctx, pool) != recovered {
				t.Fatalf("recovered receipt replay changed state: %#v, %v", replayed, err)
			}
		})
	}
}

// TestRestoreManifestReplayRequiresCurrentAuthorization prevents historical
// receipts from bypassing an actor's present account and permission state.
func TestRestoreManifestReplayRequiresCurrentAuthorization(t *testing.T) {
	for _, scenario := range []struct {
		name, mutation string
		intermediate   bool
	}{
		{name: "permission_revoked", mutation: `update user_group set permissions=permissions-'short_link:create' where key='user'`},
		{name: "field_permission_revoked", mutation: `update user_group set permissions=permissions-'short_link:use_intermediate' where key='user'`, intermediate: true},
		{name: "actor_disabled", mutation: `update app_user set status='disabled' where username='restore-replay-revoked'`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "restore-replay-revoked", permission.GroupUser, permission.UserPermissions)
			service := shortlink.NewService(pool, permission.NewService())
			input := manifestRestoreStorageInput(1)
			if scenario.intermediate {
				input.Items[0].RedirectMode = "intermediate"
				input.Items[0].IntermediateDelaySeconds = "7"
			}
			created, err := service.RestoreManifest(ctx, actor, input)
			if err != nil || created.CreatedCount != 1 || created.RequestID != input.RequestID {
				t.Fatalf("initial restore = %#v, %v", created, err)
			}
			if _, err := pool.Exec(ctx, scenario.mutation); err != nil {
				t.Fatalf("change authoritative actor state: %v", err)
			}
			before := manifestRestoreStorageSnapshot(t, ctx, pool)
			for attempt := 0; attempt < 2; attempt++ {
				result, err := service.RestoreManifest(ctx, actor, input)
				if !errors.Is(err, shortlink.ErrPermissionDenied) || result != (shortlink.BatchCreateResult{}) {
					t.Fatalf("attempt %d replay = %#v, %v; want current authorization denial", attempt, result, err)
				}
				if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != before {
					t.Fatalf("attempt %d unauthorized replay changed persisted links, events, audit, quota, or receipts", attempt)
				}
			}
		})
	}
}

// TestRestoreManifestConcurrentRequests proves that overlapping requests do not
// double-create links, spend quota twice, or lose the successful receipt.
func TestRestoreManifestConcurrentRequests(t *testing.T) {
	for _, scenario := range []string{"same_request", "different_request_ids", "same_id_different_payload"} {
		t.Run(scenario, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "restore-concurrent", permission.GroupUser, permission.UserPermissions)
			service := shortlink.NewService(pool, permission.NewService())
			inputs := [2]shortlink.ManifestRestoreInput{manifestRestoreStorageInput(21), manifestRestoreStorageInput(21)}
			if scenario != "different_request_ids" {
				inputs[1].RequestID = inputs[0].RequestID
			}
			if scenario == "same_id_different_payload" {
				inputs[1].Items[0].Title = "Other request"
			}
			type completion struct {
				index  int
				result shortlink.BatchCreateResult
				err    error
			}
			start := make(chan struct{})
			completed := make(chan completion, 2)
			for index, input := range inputs {
				go func() {
					<-start
					result, err := service.RestoreManifest(ctx, actor, input)
					completed <- completion{index: index, result: result, err: err}
				}()
			}
			close(start)
			successes, rejections, winner := 0, 0, -1
			for range inputs {
				outcome := <-completed
				if outcome.err == nil {
					successes++
					winner = outcome.index
					if outcome.result.CreatedCount != 21 || outcome.result.RequestID != inputs[outcome.index].RequestID {
						t.Fatalf("successful concurrent request returned %#v", outcome.result)
					}
					continue
				}
				rejections++
				want := shortlink.ErrSlugConflict
				if scenario == "same_id_different_payload" {
					want = shortlink.ErrBulkCreateConflict
				}
				if scenario == "same_request" || !errors.Is(outcome.err, want) || outcome.result != (shortlink.BatchCreateResult{}) {
					t.Fatalf("concurrent rejection = %#v, %v; want %v", outcome.result, outcome.err, want)
				}
			}
			wantSuccesses := 1
			if scenario == "same_request" {
				wantSuccesses = 2
			}
			if successes != wantSuccesses || rejections != 2-wantSuccesses {
				t.Fatalf("concurrent outcomes: successes=%d rejections=%d", successes, rejections)
			}
			var links, audits, receipts, usage, events int
			var title string
			if err := pool.QueryRow(ctx, `select
				(select count(*) from short_link),
				(select count(*) from audit_log where actor_id=$1::uuid and resource_type='short_link' and action='create'),
				(select count(*) from short_link_create_batch where actor_id=$1::uuid and request_id=$2::uuid and created_count=21),
				(select used from account_daily_create_usage where actor_id=$1::uuid),
				(select count(*) from short_link_event),
				(select title from short_link where slug='restorecheck000')
			`, actor.ID, inputs[winner].RequestID).Scan(&links, &audits, &receipts, &usage, &events, &title); err != nil {
				t.Fatal(err)
			}
			if links != 21 || audits != 21 || receipts != 1 || usage != 21 || events != 0 || title != inputs[winner].Items[0].Title {
				t.Fatalf("concurrent state: links=%d audit=%d receipts=%d quota=%d events=%d title=%q", links, audits, receipts, usage, events, title)
			}
		})
	}
}

// TestManifestRestoreReceiptCapacityMigration exercises the migration SQL in
// PostgreSQL transactions; the separate formal Goose runner is still required.
func TestManifestRestoreReceiptCapacityMigration(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	actor := insertShortLinkUser(t, ctx, pool, "restore-migration", permission.GroupUser, permission.UserPermissions)
	up, down := manifestRestoreReceiptMigrationSQL(t)
	insertReceipt := func(count int) error {
		_, err := pool.Exec(ctx, `insert into short_link_create_batch(actor_id,request_id,request_hash,created_count)
			values($1::uuid,$2::uuid,decode(repeat('00',32),'hex'),$3)`, actor.ID, uuid.NewString(), count)
		return err
	}
	if err := insertReceipt(20); err != nil {
		t.Fatal(err)
	}
	legacy := manifestRestoreStorageSnapshot(t, ctx, pool)
	if err := manifestRestoreMigrationTransaction(ctx, pool, down); err != nil {
		t.Fatalf("Down with legacy receipt: %v", err)
	}
	if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != legacy {
		t.Fatal("Down changed a legacy receipt")
	}
	var pgErr *pgconn.PgError
	if err := insertReceipt(21); !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("legacy 21-row constraint: %v", err)
	}
	if err := manifestRestoreMigrationTransaction(ctx, pool, up); err != nil {
		t.Fatalf("Up after Down: %v", err)
	}
	if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != legacy {
		t.Fatal("Up changed a legacy receipt")
	}
	for _, count := range []int{1, 21, 100} {
		if err := insertReceipt(count); err != nil {
			t.Fatalf("valid manifest receipt %d: %v", count, err)
		}
	}
	for _, count := range []int{0, 101} {
		if err := insertReceipt(count); !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("invalid receipt %d: %v", count, err)
		}
	}
	beforeRefusal := manifestRestoreStorageSnapshot(t, ctx, pool)
	err := manifestRestoreMigrationTransaction(ctx, pool, down)
	if !errors.As(err, &pgErr) || pgErr.Code != "P0001" || !strings.Contains(pgErr.Message, "cannot reduce receipt capacity") {
		t.Fatalf("Down must explicitly refuse retained large receipts: %v", err)
	}
	if after := manifestRestoreStorageSnapshot(t, ctx, pool); after != beforeRefusal {
		t.Fatal("refused Down changed receipt or business data")
	}
	// A failed Down must retain the widened constraint, not leave it dropped or narrowed.
	if err := insertReceipt(100); err != nil {
		t.Fatalf("large receipt after refused Down: %v", err)
	}
	if err := insertReceipt(101); !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("upper bound after refused Down: %v", err)
	}
}

func manifestRestoreMigrationTransaction(ctx context.Context, pool *pgxpool.Pool, sql string) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err := tx.Exec(ctx, sql); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func manifestRestoreReceiptMigrationSQL(t *testing.T) (string, string) {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for {
		body, err := os.ReadFile(filepath.Join(dir, "migrations", "00048_manifest_restore_receipt_capacity.sql"))
		if err == nil {
			parts := strings.SplitN(string(body), "-- +goose Down", 2)
			if len(parts) != 2 {
				t.Fatal("receipt migration must have Up and Down")
			}
			return parts[0], parts[1]
		}
		if !os.IsNotExist(err) || filepath.Dir(dir) == dir {
			t.Fatalf("locate receipt migration: %v", err)
		}
		dir = filepath.Dir(dir)
	}
}
