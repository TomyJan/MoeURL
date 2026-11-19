package shortlink_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestRestoreManifestAtomicAndAuthorized(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "restore-owner", permission.GroupUser, permission.UserPermissions)
	const assignedDomainID = "00000000-0000-0000-0000-000000000302"
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'https://assigned.example.com', 'Assigned', 'short_link', true, false, now(), now())
	`, assignedDomainID); err != nil {
		t.Fatalf("seed assigned domain: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain_user_group (domain_id, user_group_id)
		values ($1, '00000000-0000-0000-0000-000000000401')
	`, assignedDomainID); err != nil {
		t.Fatalf("grant assigned domain: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())
	requestID := uuid.NewString()
	input := shortlink.ManifestRestoreInput{RequestID: requestID, Items: []shortlink.ManifestRestoreItem{
		{
			DomainOrigin: "https://go.example.com", Slug: "restore1", TargetURL: "https://target.example/one",
			Title: "Restored active", Tags: []string{"docs"}, Status: "active", RedirectMode: shortlink.RedirectModeDirect,
			IntermediateDelaySeconds: "5", ExpiresAt: "", MaxVisits: "",
		},
		{
			DomainOrigin: "https://assigned.example.com", Slug: "restore2", TargetURL: "https://target.example/two",
			Title: "Restored disabled", Tags: []string{"saved"}, Status: "disabled", RedirectMode: shortlink.RedirectModeIntermediate,
			IntermediateDelaySeconds: "7", ExpiresAt: "2099-01-02T03:04:05Z", MaxVisits: "5",
		},
	}}

	result, err := service.RestoreManifest(ctx, user, input)
	if err != nil || result.RequestID != requestID || result.CreatedCount != len(input.Items) {
		t.Fatalf("restore result = %#v, %v", result, err)
	}
	for _, want := range []struct {
		slug, domainID, status, mode, title, tag string
		delay                                    int16
		expiresAt                                pgtype.Timestamptz
		maxVisits                                pgtype.Int4
	}{
		{slug: "restore1", domainID: "00000000-0000-0000-0000-000000000301", status: "active", mode: "direct", title: "Restored active", tag: "docs", delay: 5},
		{slug: "restore2", domainID: assignedDomainID, status: "disabled", mode: "intermediate", title: "Restored disabled", tag: "saved", delay: 7,
			expiresAt: pgtype.Timestamptz{Time: time.Date(2099, 1, 2, 3, 4, 5, 0, time.UTC), Valid: true}, maxVisits: pgtype.Int4{Int32: 5, Valid: true}},
	} {
		var ownerID, domainID, status, mode, title, password string
		var visits int64
		var tags []string
		var delay int16
		var expiresAt pgtype.Timestamptz
		var maxVisits pgtype.Int4
		err := pool.QueryRow(ctx, `
			select owner_id::text, domain_id::text, status, redirect_mode, intermediate_delay_seconds,
			       coalesce(password_hash, ''), title, tags, visits_used, expires_at, max_visits
			from short_link where slug = $1
		`, want.slug).Scan(&ownerID, &domainID, &status, &mode, &delay, &password, &title, &tags, &visits, &expiresAt, &maxVisits)
		if err != nil {
			t.Fatalf("read restored %s: %v", want.slug, err)
		}
		if ownerID != user.ID || domainID != want.domainID || status != want.status || mode != want.mode || delay != want.delay || title != want.title || len(tags) != 1 || tags[0] != want.tag {
			t.Errorf("restored fields for %s do not match: owner=%s domain=%s status=%s mode=%s delay=%d title=%q tags=%v", want.slug, ownerID, domainID, status, mode, delay, title, tags)
		}
		if visits != 0 || password != "" || maxVisits != want.maxVisits || expiresAt != want.expiresAt {
			t.Errorf("snapshot-only fields were restored for %s: visits=%d password=%t maxVisits=%#v expiration=%#v", want.slug, visits, password != "", maxVisits, expiresAt)
		}
	}
	var createdAuditCount int
	if err := pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='short_link' and action='create'`, user.ID).Scan(&createdAuditCount); err != nil {
		t.Fatalf("count creation audit: %v", err)
	}
	if createdAuditCount != 2 {
		t.Fatalf("creation audit count = %d, want 2", createdAuditCount)
	}

	replayed, err := service.RestoreManifest(ctx, user, input)
	if err != nil || replayed.CreatedCount != 2 {
		t.Fatalf("idempotent replay = %#v, %v", replayed, err)
	}
	changed := input
	changed.Items = append([]shortlink.ManifestRestoreItem(nil), input.Items...)
	changed.Items[0].Title = "Different payload"
	if _, err := service.RestoreManifest(ctx, user, changed); !errors.Is(err, shortlink.ErrBulkCreateConflict) {
		t.Fatalf("same key with different payload error = %v, want conflict", err)
	}

	insertStoredShortLink(t, ctx, pool, user.ID, "occupied1", "https://target.example/existing", "active", false)
	var usageBefore int64
	if err := pool.QueryRow(ctx, `select used from account_daily_create_usage where actor_id=$1`, user.ID).Scan(&usageBefore); err != nil {
		t.Fatalf("read quota before conflict: %v", err)
	}
	var auditBefore int
	if err := pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='short_link'`, user.ID).Scan(&auditBefore); err != nil {
		t.Fatalf("read audit before conflict: %v", err)
	}
	conflictInput := shortlink.ManifestRestoreInput{RequestID: uuid.NewString(), Items: make([]shortlink.ManifestRestoreItem, 100)}
	for index := 0; index < 99; index++ {
		conflictInput.Items[index] = shortlink.ManifestRestoreItem{
			DomainOrigin: "https://go.example.com", Slug: fmt.Sprintf("rollback%02d", index),
			TargetURL: fmt.Sprintf("https://target.example/rollback/%d", index), Tags: []string{},
			Status: "active", RedirectMode: "direct", IntermediateDelaySeconds: "5",
		}
	}
	conflictInput.Items[99] = shortlink.ManifestRestoreItem{
		DomainOrigin: "https://go.example.com", Slug: "occupied1", TargetURL: "https://target.example/conflict",
		Tags: []string{}, Status: "active", RedirectMode: "direct", IntermediateDelaySeconds: "5",
	}
	if _, err := service.RestoreManifest(ctx, user, conflictInput); !errors.Is(err, shortlink.ErrSlugConflict) {
		t.Fatalf("slug conflict error = %v, want ErrSlugConflict", err)
	}
	var rollbackCount, receiptCount int
	if err := pool.QueryRow(ctx, `select count(*) from short_link where slug like 'rollback%'`).Scan(&rollbackCount); err != nil {
		t.Fatalf("check rolled-back link: %v", err)
	}
	if err := pool.QueryRow(ctx, `select count(*) from short_link_create_batch where actor_id=$1 and request_id=$2`, user.ID, conflictInput.RequestID).Scan(&receiptCount); err != nil {
		t.Fatalf("check rolled-back receipt: %v", err)
	}
	var usageAfter int64
	if err := pool.QueryRow(ctx, `select used from account_daily_create_usage where actor_id=$1`, user.ID).Scan(&usageAfter); err != nil {
		t.Fatalf("read quota after conflict: %v", err)
	}
	var auditAfter int
	if err := pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='short_link'`, user.ID).Scan(&auditAfter); err != nil {
		t.Fatalf("read audit after conflict: %v", err)
	}
	if rollbackCount != 0 || receiptCount != 0 || usageAfter != usageBefore || auditAfter != auditBefore {
		t.Fatalf("conflict was not atomic: links=%d receipts=%d quota=%d->%d audit=%d->%d", rollbackCount, receiptCount, usageBefore, usageAfter, auditBefore, auditAfter)
	}
}
