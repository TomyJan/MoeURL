package domain_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
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
	repeated, err := service.SetDefault(ctx, admin, domain.ChangeInput{ID: selected.ID, ExpectedUpdatedAt: selected.UpdatedAt})
	if err != nil || repeated.UpdatedAt <= selected.UpdatedAt {
		t.Fatalf("repeated default version = %q after %q, error = %v", repeated.UpdatedAt, selected.UpdatedAt, err)
	}
	if _, err := service.SetDefault(ctx, admin, domain.ChangeInput{ID: selected.ID, ExpectedUpdatedAt: selected.UpdatedAt}); !errors.Is(err, domain.ErrVersionConflict) {
		t.Fatalf("stale repeated default error = %v", err)
	}
	if err := service.Delete(ctx, admin, domain.ChangeInput{ID: repeated.ID, ExpectedUpdatedAt: repeated.UpdatedAt}); !errors.Is(err, domain.ErrDomainProtected) {
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
	selected, err := service.SetDefault(t.Context(), admin, domain.ChangeInput{ID: created.ID, ExpectedUpdatedAt: created.UpdatedAt})
	if err != nil || !selected.Referenced {
		t.Fatalf("set referenced domain as default = %#v, error = %v", selected, err)
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

func TestServiceUpdatesUnparseableLegacyAddressMetadata(t *testing.T) {
	service, pool, admin, _ := domainFixture(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `update domain set host = 'legacy_host' where is_default`); err != nil {
		t.Fatalf("prepare legacy address: %v", err)
	}
	listing, err := service.List(ctx, admin)
	if err != nil || len(listing.Items) != 1 {
		t.Fatalf("list legacy address = %#v, %v", listing, err)
	}
	legacy := listing.Items[0]
	updated, err := service.Update(ctx, admin, domain.UpdateInput{
		ID: legacy.ID, Host: legacy.Host, DisplayName: "Renamed legacy", Enabled: true,
		AllowedGroups: []string{"admin"}, ExpectedUpdatedAt: legacy.UpdatedAt,
	})
	if err != nil || updated.Host != legacy.Host || updated.DisplayName != "Renamed legacy" {
		t.Fatalf("legacy metadata update = %#v, %v", updated, err)
	}
}

func TestServiceUpdatesUnreferencedDefaultAddressAndSettingMirror(t *testing.T) {
	service, pool, admin, _ := domainFixture(t)
	listing, err := service.List(t.Context(), admin)
	if err != nil || len(listing.Items) != 1 {
		t.Fatalf("list default = %#v, error = %v", listing, err)
	}
	current, err := service.SetDefault(t.Context(), admin, domain.ChangeInput{
		ID: listing.Items[0].ID, ExpectedUpdatedAt: listing.Items[0].UpdatedAt,
	})
	if err != nil {
		t.Fatalf("initialize default mirror: %v", err)
	}
	updated, err := service.Update(t.Context(), admin, domain.UpdateInput{
		ID: current.ID, Host: "https://new-default.example.com", DisplayName: current.DisplayName,
		Enabled: true, AllowedGroups: current.AllowedGroups, ExpectedUpdatedAt: current.UpdatedAt,
	})
	if err != nil || updated.Host != "https://new-default.example.com" {
		t.Fatalf("update default address = %#v, error = %v", updated, err)
	}
	var mirrored string
	if err := pool.QueryRow(t.Context(), `select value #>> '{}' from system_setting where key = 'site.default_short_link_domain'`).Scan(&mirrored); err != nil || mirrored != updated.Host {
		t.Fatalf("mirrored default = %q, want %q, error = %v", mirrored, updated.Host, err)
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

func TestDefaultSwitchAndConcurrentCreationUseTheNewDefault(t *testing.T) {
	service, pool, admin, user := domainFixture(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `update user_group set permissions = permissions || '["short_link:create"]'::jsonb where key = 'user'`); err != nil {
		t.Fatalf("grant create permission: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into app_user (id, username, nickname, group_id, status, builtin, created_at, updated_at)
		select $1, 'switch-creator', 'Creator', id, 'active', false, now(), now() from user_group where key = 'user'
	`, user.ID); err != nil {
		t.Fatalf("prepare creator: %v", err)
	}
	next, err := service.Create(ctx, admin, domain.CreateInput{
		Host: "https://next.example.com", DisplayName: "Next", AllowedGroups: []string{"user"}, Enabled: true,
	})
	if err != nil {
		t.Fatalf("prepare next default: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into system_setting (key, value, created_at, updated_at)
		values ('site.default_short_link_domain', '"go.example.com"'::jsonb, now(), now())
	`); err != nil {
		t.Fatalf("prepare default mirror: %v", err)
	}
	gate, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin mirror lock: %v", err)
	}
	defer func() { _ = gate.Rollback(ctx) }()
	if _, err := gate.Exec(ctx, `select value from system_setting where key = 'site.default_short_link_domain' for update`); err != nil {
		t.Fatalf("lock default mirror: %v", err)
	}
	changed := make(chan error, 1)
	go func() {
		_, err := service.SetDefault(ctx, admin, domain.ChangeInput{ID: next.ID, ExpectedUpdatedAt: next.UpdatedAt})
		changed <- err
	}()
	waitForDomainLockWaiters(t, pool, 1)
	creation := make(chan struct {
		url string
		err error
	}, 1)
	go func() {
		result, err := shortlink.NewService(pool, permission.NewDatabaseService(pool)).Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com"})
		creation <- struct {
			url string
			err error
		}{result.ShortLink.URL, err}
	}()
	waitForDomainLockWaiters(t, pool, 2)
	if err := gate.Commit(ctx); err != nil {
		t.Fatalf("release default mirror: %v", err)
	}
	select {
	case err := <-changed:
		if err != nil {
			t.Fatalf("switch default: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("default switch did not complete")
	}
	select {
	case result := <-creation:
		if result.err != nil || !strings.HasPrefix(result.url, "https://next.example.com/") {
			t.Fatalf("create during default switch = %q, %v", result.url, result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("short-link creation did not complete")
	}
}

func waitForDomainLockWaiters(t *testing.T, pool *pgxpool.Pool, want int) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		err := pool.QueryRow(ctx, `
			select count(*) from pg_stat_activity
			where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()
		`).Scan(&count)
		if err != nil {
			t.Fatalf("inspect lock waiters: %v", err)
		}
		if count >= want {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("waiting for %d lock waiters: %v", want, ctx.Err())
		case <-ticker.C:
		}
	}
}
