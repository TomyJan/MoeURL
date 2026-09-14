package domain_test

import (
	"errors"
	"sync"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func domainFixture(t *testing.T) (*domain.Service, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	userID, adminID, defaultID := uuid.New(), uuid.New(), uuid.New()
	if _, err := pool.Exec(t.Context(), `
		insert into user_group (id, key, name, permissions, builtin, created_at, updated_at)
		values ($1, 'user', 'User', '["domain:use_default","domain:use_assigned"]', true, now(), now()),
		       ($2, 'admin', 'Admin', '["admin:access","domain:manage","domain:use_default","domain:use_assigned"]', true, now(), now())
	`, userID, adminID); err != nil {
		t.Fatalf("prepare groups: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'go.example.com', 'Existing', 'short_link', true, true, now(), now())
	`, defaultID); err != nil {
		t.Fatalf("prepare default domain: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		insert into domain_user_group (domain_id, user_group_id) values ($1, $2), ($1, $3)
	`, defaultID, userID, adminID); err != nil {
		t.Fatalf("prepare grants: %v", err)
	}
	return domain.NewService(pool, permission.NewService()), pool,
		auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupAdmin},
		auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupUser}
}

func TestServiceManagesDomainsWithAuthorizationAndOptimisticConcurrency(t *testing.T) {
	service, pool, admin, user := domainFixture(t)
	ctx := t.Context()
	if _, err := service.List(ctx, user); !errors.Is(err, domain.ErrPermissionDenied) {
		t.Fatalf("non-admin list error = %v", err)
	}
	created, err := service.Create(ctx, admin, domain.CreateInput{
		Host: "https://new.example.com", DisplayName: "New", AllowedGroups: []string{"user"}, Enabled: true,
	})
	if err != nil || created.Host != "https://new.example.com" || len(created.AllowedGroups) != 1 {
		t.Fatalf("create domain = %#v, error = %v", created, err)
	}
	if _, err := service.Create(ctx, admin, domain.CreateInput{
		Host: "https://NEW.example.com:443/", DisplayName: "Duplicate", AllowedGroups: []string{"admin"}, Enabled: true,
	}); !errors.Is(err, domain.ErrDomainConflict) {
		t.Fatalf("equivalent authority error = %v", err)
	}
	available, err := service.Available(ctx, user)
	if err != nil || len(available.Items) != 2 {
		t.Fatalf("user available domains = %#v, error = %v", available, err)
	}
	updated, err := service.Update(ctx, admin, domain.UpdateInput{
		ID: created.ID, Host: created.Host, DisplayName: "Renamed", Enabled: false,
		AllowedGroups: []string{"admin"}, ExpectedUpdatedAt: created.UpdatedAt,
	})
	if err != nil || updated.Enabled || updated.DisplayName != "Renamed" {
		t.Fatalf("update domain = %#v, error = %v", updated, err)
	}
	if _, err := service.Update(ctx, admin, domain.UpdateInput{
		ID: created.ID, Host: created.Host, DisplayName: "Lost", Enabled: true,
		AllowedGroups: []string{"user"}, ExpectedUpdatedAt: created.UpdatedAt,
	}); !errors.Is(err, domain.ErrVersionConflict) {
		t.Fatalf("stale update error = %v", err)
	}
	available, err = service.Available(ctx, user)
	if err != nil || len(available.Items) != 1 || !available.Items[0].IsDefault {
		t.Fatalf("disabled/ungranted domain available = %#v, error = %v", available, err)
	}
	if _, err := service.SetDefault(ctx, admin, domain.ChangeInput{ID: updated.ID, ExpectedUpdatedAt: updated.UpdatedAt}); !errors.Is(err, domain.ErrDomainProtected) {
		t.Fatalf("disabled default error = %v", err)
	}
	updated, err = service.Update(ctx, admin, domain.UpdateInput{
		ID: updated.ID, Host: updated.Host, DisplayName: updated.DisplayName, Enabled: true,
		AllowedGroups: []string{"user"}, ExpectedUpdatedAt: updated.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("enable domain: %v", err)
	}
	selected, err := service.SetDefault(ctx, admin, domain.ChangeInput{ID: updated.ID, ExpectedUpdatedAt: updated.UpdatedAt})
	if err != nil || !selected.IsDefault {
		t.Fatalf("set default = %#v, error = %v", selected, err)
	}
	var mirrored string
	if err := pool.QueryRow(ctx, `select value #>> '{}' from system_setting where key = 'site.default_short_link_domain'`).Scan(&mirrored); err != nil || mirrored != selected.Host {
		t.Fatalf("mirrored default = %q, error = %v", mirrored, err)
	}
	if err := service.Delete(ctx, admin, domain.ChangeInput{ID: selected.ID, ExpectedUpdatedAt: selected.UpdatedAt}); !errors.Is(err, domain.ErrDomainProtected) {
		t.Fatalf("delete default error = %v", err)
	}
}

func TestServiceKeepsReferencedAddressAndDeletesOnlyUnreferencedDomain(t *testing.T) {
	service, pool, admin, _ := domainFixture(t)
	created, err := service.Create(t.Context(), admin, domain.CreateInput{
		Host: "https://other.example.com", DisplayName: "Other", AllowedGroups: []string{"user"}, Enabled: true,
	})
	if err != nil {
		t.Fatalf("create domain: %v", err)
	}
	userID := uuid.New()
	if _, err := pool.Exec(t.Context(), `
		insert into app_user (id, username, nickname, group_id, status, builtin, created_at, updated_at)
		select $1, 'domain-owner', 'Owner', id, 'active', false, now(), now() from user_group where key = 'user'
	`, userID); err != nil {
		t.Fatalf("prepare owner: %v", err)
	}
	if _, err := pool.Exec(t.Context(), `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, deleted_at, created_at, updated_at)
		values ($1, $2, $3, 'legacy-soft-deleted', 'https://target.example.com', 'active', now(), now(), now())
	`, uuid.New(), userID, created.ID); err != nil {
		t.Fatalf("prepare referenced link: %v", err)
	}
	if _, err := service.Update(t.Context(), admin, domain.UpdateInput{
		ID: created.ID, Host: "https://changed.example.com", DisplayName: "Other", Enabled: true,
		AllowedGroups: []string{"user"}, ExpectedUpdatedAt: created.UpdatedAt,
	}); !errors.Is(err, domain.ErrDomainReferenced) {
		t.Fatalf("referenced host update error = %v", err)
	}
	if err := service.Delete(t.Context(), admin, domain.ChangeInput{ID: created.ID, ExpectedUpdatedAt: created.UpdatedAt}); !errors.Is(err, domain.ErrDomainReferenced) {
		t.Fatalf("referenced delete error = %v", err)
	}
	unreferenced, err := service.Create(t.Context(), admin, domain.CreateInput{
		Host: "https://unused.example.com", DisplayName: "Unused", AllowedGroups: []string{}, Enabled: false,
	})
	if err != nil {
		t.Fatalf("create unreferenced domain: %v", err)
	}
	if err := service.Delete(t.Context(), admin, domain.ChangeInput{ID: unreferenced.ID, ExpectedUpdatedAt: unreferenced.UpdatedAt}); err != nil {
		t.Fatalf("delete unused domain: %v", err)
	}
}

func TestServiceUpdatesLegacyDefaultWithoutRewritingItsAddress(t *testing.T) {
	service, _, admin, _ := domainFixture(t)
	listing, err := service.List(t.Context(), admin)
	if err != nil || len(listing.Items) != 1 {
		t.Fatalf("list legacy default = %#v, %v", listing, err)
	}
	legacy := listing.Items[0]
	updated, err := service.Update(t.Context(), admin, domain.UpdateInput{
		ID: legacy.ID, Host: legacy.Host, DisplayName: "Renamed legacy", Enabled: true,
		AllowedGroups: []string{"user", "admin"}, ExpectedUpdatedAt: legacy.UpdatedAt,
	})
	if err != nil || updated.Host != "go.example.com" || updated.DisplayName != "Renamed legacy" {
		t.Fatalf("legacy metadata update = %#v, %v", updated, err)
	}
}

func TestServiceSerializesEquivalentAuthorityRegistration(t *testing.T) {
	service, _, admin, _ := domainFixture(t)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wait sync.WaitGroup
	for _, host := range []string{"https://race.example.com", "https://RACE.example.com:443/"} {
		wait.Add(1)
		go func(host string) {
			defer wait.Done()
			<-start
			_, err := service.Create(t.Context(), admin, domain.CreateInput{
				Host: host, DisplayName: host, AllowedGroups: []string{"user"}, Enabled: true,
			})
			results <- err
		}(host)
	}
	close(start)
	wait.Wait()
	close(results)
	success, conflict := 0, 0
	for err := range results {
		switch {
		case err == nil:
			success++
		case errors.Is(err, domain.ErrDomainConflict):
			conflict++
		default:
			t.Fatalf("unexpected concurrent creation error: %v", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("concurrent registration = %d successes, %d conflicts", success, conflict)
	}
}
