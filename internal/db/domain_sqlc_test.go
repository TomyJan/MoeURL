package db_test

import (
	"errors"
	"testing"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestDomainQueriesFilterGrantsAndReferences exercises the generated domain contract against PostgreSQL.
func TestDomainQueriesFilterGrantsAndReferences(t *testing.T) {
	ctx := t.Context()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	userGroupID := uuid.New()
	defaultID := uuid.New()
	assignedID := uuid.New()
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, permissions, builtin, created_at, updated_at)
		values ($1, 'user', 'User', '["short_link:create","domain:use_default","domain:use_assigned"]'::jsonb, true, now(), now())
	`, userGroupID); err != nil {
		t.Fatalf("prepare user group: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'go.example.com', 'Default', 'short_link', true, true, now(), now()),
		       ($2, 'https://alt.example.com', 'Alternative', 'short_link', true, false, now(), now())
	`, defaultID, assignedID); err != nil {
		t.Fatalf("prepare domains: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain_user_group (domain_id, user_group_id) values ($1, $3), ($2, $3)
	`, defaultID, assignedID, userGroupID); err != nil {
		t.Fatalf("prepare domain grants: %v", err)
	}
	managed, err := queries.ListManagedDomains(ctx)
	if err != nil || len(managed) != 2 || managed[0].ID != uuidToPgtype(defaultID) {
		t.Fatalf("managed domains = %#v, error = %v", managed, err)
	}
	available, err := queries.ListAvailableShortLinkDomains(ctx, sqlc.ListAvailableShortLinkDomainsParams{
		GroupKey: "user", CanDefault: true, CanAssigned: false,
	})
	if err != nil || len(available) != 1 || available[0].ID != uuidToPgtype(defaultID) {
		t.Fatalf("default-only domains = %#v, error = %v", available, err)
	}
	available, err = queries.ListAvailableShortLinkDomains(ctx, sqlc.ListAvailableShortLinkDomainsParams{
		GroupKey: "user", CanDefault: false, CanAssigned: true,
	})
	if err != nil || len(available) != 1 || available[0].ID != uuidToPgtype(assignedID) {
		t.Fatalf("explicitly selectable domains = %#v, error = %v", available, err)
	}
	if _, err := queries.GetGrantedShortLinkDomainForCreate(ctx, sqlc.GetGrantedShortLinkDomainForCreateParams{
		GroupKey: "user", RequiredPermission: "domain:use_assigned", UseDefault: false,
		DomainID: uuidToPgtype(defaultID),
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("explicit default selection error = %v, want pgx.ErrNoRows", err)
	}
	selected, err := queries.GetGrantedShortLinkDomainForCreate(ctx, sqlc.GetGrantedShortLinkDomainForCreateParams{
		GroupKey: "user", RequiredPermission: "domain:use_assigned", UseDefault: false,
		DomainID: uuidToPgtype(assignedID),
	})
	if err != nil || selected.ID != uuidToPgtype(assignedID) {
		t.Fatalf("explicit assigned selection = %#v, error = %v", selected, err)
	}
	grants, err := queries.ListDomainGrantKeys(ctx, uuidToPgtype(assignedID))
	if err != nil || len(grants) != 1 || grants[0] != "user" {
		t.Fatalf("assigned domain grants = %#v, error = %v", grants, err)
	}
	if err := queries.DeleteDomainGrants(ctx, uuidToPgtype(assignedID)); err != nil {
		t.Fatalf("remove assigned domain grant: %v", err)
	}
	available, err = queries.ListAvailableShortLinkDomains(ctx, sqlc.ListAvailableShortLinkDomainsParams{
		GroupKey: "user", CanDefault: false, CanAssigned: true,
	})
	if err != nil || len(available) != 0 {
		t.Fatalf("ungranted domain should be unavailable: %#v, %v", available, err)
	}
}

// TestDomainQueriesProtectDefaultAndReferences verifies atomic default changes and immutable referenced domains.
func TestDomainQueriesProtectDefaultAndReferences(t *testing.T) {
	ctx := t.Context()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	oldID, nextID := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'old.example.com', 'Old', 'short_link', true, true, now(), now()),
		       ($2, 'next.example.com', 'Next', 'short_link', true, false, now(), now())
	`, oldID, nextID); err != nil {
		t.Fatalf("prepare domains: %v", err)
	}
	managed, err := queries.ListManagedDomains(ctx)
	if err != nil || len(managed) != 2 {
		t.Fatalf("managed domains = %#v, error = %v", managed, err)
	}
	old, next := managed[0], managed[1]
	if err := appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
		q := queries.WithTx(tx)
		if err := q.ClearDefaultShortLinkDomain(ctx); err != nil {
			return err
		}
		_, err := q.MakeDefaultShortLinkDomain(ctx, sqlc.MakeDefaultShortLinkDomainParams{ID: next.ID, UpdatedAt: next.UpdatedAt})
		return err
	}); err != nil {
		t.Fatalf("switch default: %v", err)
	}
	defaultDomain, err := queries.GetDefaultShortLinkDomain(ctx)
	if err != nil || defaultDomain.ID != next.ID {
		t.Fatalf("default domain = %#v, error = %v", defaultDomain, err)
	}
	stale := sqlc.UpdateManagedDomainParams{
		ID: old.ID, Host: old.Host, DisplayName: "Changed", Enabled: true,
		UpdatedAt: old.UpdatedAt,
	}
	if _, err := queries.UpdateManagedDomain(ctx, stale); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("stale timestamp update error = %v, want pgx.ErrNoRows", err)
	}
	if count, err := queries.DeleteManagedDomain(ctx, sqlc.DeleteManagedDomainParams{ID: next.ID, UpdatedAt: defaultDomain.UpdatedAt}); err != nil || count != 0 {
		t.Fatalf("delete current default = %d, %v", count, err)
	}
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, permissions, builtin, created_at, updated_at)
		values ($1, 'user', 'User', '[]', true, now(), now())
	`, uuid.New()); err != nil {
		t.Fatalf("prepare group: %v", err)
	}
	userID := uuid.New()
	if _, err := pool.Exec(ctx, `
		insert into app_user (id, username, nickname, group_id, status, builtin, created_at, updated_at)
		select $1, 'domain-test', 'Domain test', id, 'active', false, now(), now()
		from user_group where key = 'user'
	`, userID); err != nil {
		t.Fatalf("prepare user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, deleted_at, created_at, updated_at)
		values ($1, $2, $3, 'deleted-link', 'https://target.example.com', 'active', now(), now(), now())
	`, uuid.New(), userID, oldID); err != nil {
		t.Fatalf("prepare soft-deleted link: %v", err)
	}
	if referenced, err := queries.DomainHasReferences(ctx, old.ID); err != nil || !referenced {
		t.Fatalf("soft-deleted link reference = %v, %v", referenced, err)
	}
	currentOld, err := queries.GetManagedDomainForUpdate(ctx, old.ID)
	if err != nil {
		t.Fatalf("load former default: %v", err)
	}
	if count, err := queries.DeleteManagedDomain(ctx, sqlc.DeleteManagedDomainParams{ID: old.ID, UpdatedAt: currentOld.UpdatedAt}); err != nil || count != 0 {
		t.Fatalf("delete referenced domain = %d, %v", count, err)
	}
	if _, err := queries.MakeDefaultShortLinkDomain(ctx, sqlc.MakeDefaultShortLinkDomainParams{
		ID: old.ID, UpdatedAt: currentOld.UpdatedAt,
	}); err == nil {
		t.Fatal("setting a second default outside a transaction should fail unique constraint")
	} else if varPgError := new(pgconn.PgError); !errors.As(err, &varPgError) || varPgError.Code != "23505" {
		t.Fatalf("second default error = %v, want 23505", err)
	}
}
