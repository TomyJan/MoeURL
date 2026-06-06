package shortlink_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"regexp"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestServiceCreateRejectsGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)

	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Create(ctx, auth.GuestUser(), shortlink.CreateInput{TargetURL: "https://example.com"})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

func TestServiceCreateRejectsUnsafeTargetURL(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)

	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "javascript:alert(1)"})
	if !errors.Is(err, shortlink.ErrInvalidTargetURL) {
		t.Fatalf("expected ErrInvalidTargetURL, got %v", err)
	}
}

func TestServiceCreateStoresShortLinkWithGeneratedSlug(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com/path?q=1"})
	if err != nil {
		t.Fatalf("create short link: %v", err)
	}

	if result.ShortLink.ID == "" {
		t.Fatal("expected id")
	}
	if !regexp.MustCompile(`^[a-z0-9]{6}$`).MatchString(result.ShortLink.Slug) {
		t.Fatalf("unexpected slug %q", result.ShortLink.Slug)
	}
	if result.ShortLink.URL != "https://go.example.com/"+result.ShortLink.Slug {
		t.Fatalf("unexpected short link url %q", result.ShortLink.URL)
	}
	if result.ShortLink.TargetURL != "https://example.com/path?q=1" {
		t.Fatalf("unexpected target url %q", result.ShortLink.TargetURL)
	}
	if result.ShortLink.Status != "active" {
		t.Fatalf("unexpected status %q", result.ShortLink.Status)
	}

	var storedTarget string
	err = pool.QueryRow(ctx, `select target_url from short_link where slug = $1`, result.ShortLink.Slug).Scan(&storedTarget)
	if err != nil {
		t.Fatalf("query stored short link: %v", err)
	}
	if storedTarget != result.ShortLink.TargetURL {
		t.Fatalf("expected stored target %q, got %q", result.ShortLink.TargetURL, storedTarget)
	}
}

func TestServiceListReturnsOnlyOwnActiveRecords(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "alice2", "https://example.com/2", "disabled", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted", "https://example.com/deleted", "active", true)
	insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list short links: %v", err)
	}

	if result.Total != 2 {
		t.Fatalf("expected total 2, got %d", result.Total)
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result.Items))
	}
	for _, item := range result.Items {
		if item.Slug == "deleted" || item.Slug == "bob001" {
			t.Fatalf("unexpected item in list: %#v", item)
		}
		if item.URL != "https://go.example.com/"+item.Slug {
			t.Fatalf("unexpected url %q", item.URL)
		}
	}
}

func TestServiceListRejectsGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.List(ctx, auth.GuestUser(), shortlink.ListInput{Page: 1, PageSize: 20})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

func TestServiceUpdateOwnShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	targetURL := "https://example.org/updated"
	status := "disabled"

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.Update(ctx, user, shortlink.UpdateInput{ID: linkID, TargetURL: &targetURL, Status: &status})
	if err != nil {
		t.Fatalf("update short link: %v", err)
	}
	if result.ShortLink.TargetURL != targetURL {
		t.Fatalf("expected target url %q, got %q", targetURL, result.ShortLink.TargetURL)
	}
	if result.ShortLink.Status != "disabled" {
		t.Fatalf("expected disabled, got %q", result.ShortLink.Status)
	}
}

func TestServiceUpdateRejectsInvalidInputAndForeignLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	foreignLinkID := insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	invalidURL := "file:///secret"
	invalidStatus := "pending"
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, Status: ptr("disabled")})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, TargetURL: &invalidURL})
	if !errors.Is(err, shortlink.ErrInvalidTargetURL) {
		t.Fatalf("expected ErrInvalidTargetURL, got %v", err)
	}

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, Status: &invalidStatus})
	if !errors.Is(err, shortlink.ErrInvalidStatus) {
		t.Fatalf("expected ErrInvalidStatus, got %v", err)
	}
}

func TestServiceDeleteOwnShortLinkSoftDeletes(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	service := shortlink.NewService(pool, permission.NewService())

	err := service.Delete(ctx, user, shortlink.DeleteInput{ID: linkID})
	if err != nil {
		t.Fatalf("delete short link: %v", err)
	}

	var deleted bool
	err = pool.QueryRow(ctx, `select deleted_at is not null from short_link where id = $1`, linkID).Scan(&deleted)
	if err != nil {
		t.Fatalf("query deleted flag: %v", err)
	}
	if !deleted {
		t.Fatal("expected deleted_at to be set")
	}
}

func TestServiceDeleteRejectsForeignLinkAndGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	foreignLinkID := insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	service := shortlink.NewService(pool, permission.NewService())

	err := service.Delete(ctx, user, shortlink.DeleteInput{ID: foreignLinkID})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	err = service.Delete(ctx, auth.GuestUser(), shortlink.DeleteInput{ID: foreignLinkID})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

func TestServiceAdminListReturnsAllOwners(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	alice := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	bob := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	insertStoredShortLink(t, ctx, pool, alice.ID, "alice1", "https://example.com/1", "active", false)
	insertStoredShortLink(t, ctx, pool, bob.ID, "bob001", "https://example.com/bob", "disabled", false)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if result.Total != 2 || len(result.Items) != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
	owners := map[string]bool{}
	for _, item := range result.Items {
		owners[item.Owner.Username] = true
	}
	if !owners["alice"] || !owners["bob"] {
		t.Fatalf("expected alice and bob owners, got %#v", owners)
	}
}

func TestServiceAdminOperationsRequirePermissions(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}

	_, err := service.AdminList(ctx, regular, shortlink.ListInput{})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
	err = service.AdminDelete(ctx, regular, shortlink.DeleteInput{ID: "00000000-0000-0000-0000-000000000701"})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

func TestServiceAdminUpdateAndDeleteAnyShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "alice1", "https://example.com/1", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	status := "disabled"
	service := shortlink.NewService(pool, permission.NewService())

	updated, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, Status: &status})
	if err != nil {
		t.Fatalf("admin update: %v", err)
	}
	if updated.ShortLink.Status != "disabled" {
		t.Fatalf("expected disabled, got %q", updated.ShortLink.Status)
	}

	err = service.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: linkID})
	if err != nil {
		t.Fatalf("admin delete: %v", err)
	}
	var deleted bool
	err = pool.QueryRow(ctx, `select deleted_at is not null from short_link where id = $1`, linkID).Scan(&deleted)
	if err != nil {
		t.Fatalf("query deleted flag: %v", err)
	}
	if !deleted {
		t.Fatal("expected deleted_at")
	}
}

func insertShortLinkDefaultDomain(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000301', 'go.example.com', 'go.example.com', 'short_link', true, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert default domain: %v", err)
	}
}

func insertShortLinkUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, groupKey string, permissions []string) auth.CurrentUser {
	t.Helper()
	groupID := "00000000-0000-0000-0000-000000000401"
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ($1, $2, $2, '', $3::jsonb, false, now(), now())
	`, groupID, groupKey, permissionsJSON(t, permissions))
	if err != nil {
		t.Fatalf("insert user group: %v", err)
	}

	return insertShortLinkUserForGroup(t, ctx, pool, username, groupID, "00000000-0000-0000-0000-000000000501", groupKey, permissions)
}

func insertShortLinkUserForGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, groupID string, userID string, groupKey string, permissions []string) auth.CurrentUser {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, $2, 'hash', $2, $3, 'active', false, now(), now())
	`, userID, username, groupID)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return auth.CurrentUser{
		ID:          userID,
		Username:    username,
		Nickname:    username,
		GroupKey:    groupKey,
		Permissions: permissions,
	}
}

func insertStoredShortLink(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string, slug string, targetURL string, status string, deleted bool) string {
	t.Helper()
	deletedAt := "null"
	if deleted {
		deletedAt = "now()"
	}
	var id string
	err := pool.QueryRow(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at)
		values (gen_random_uuid(), $1, '00000000-0000-0000-0000-000000000301', $2, $3, $4, now(), now(), `+deletedAt+`)
		returning id::text
	`, ownerID, slug, targetURL, status).Scan(&id)
	if err != nil {
		t.Fatalf("insert stored short link: %v", err)
	}
	return id
}

func ptr(value string) *string {
	return &value
}

func permissionsJSON(t *testing.T, permissions []string) string {
	t.Helper()
	result := "["
	for index, value := range permissions {
		if index > 0 {
			result += ","
		}
		result += `"` + value + `"`
	}
	result += "]"
	return result
}

func shortLinkTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := migratedShortLinkDatabaseURL(t, ctx)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func migratedShortLinkDatabaseURL(t *testing.T, ctx context.Context) string {
	t.Helper()

	container, err := postgres.Run(ctx,
		"postgres:17-alpine",
		postgres.WithDatabase("moeurl_test"),
		postgres.WithUsername("moeurl"),
		postgres.WithPassword("moeurl"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Fatalf("terminate postgres container: %v", err)
		}
	})

	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.Up(database, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return databaseURL
}
