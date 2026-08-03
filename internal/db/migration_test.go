package db_test

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestInitialMigrationCreatesCoreTablesAndConstraints verifies the baseline schema contract.
func TestInitialMigrationCreatesCoreTablesAndConstraints(t *testing.T) {
	ctx := context.Background()
	database := migrationTestDatabase(t, ctx)

	migrationsDir := filepath.Join("..", "..", "migrations")
	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	expectedTables := []string{"system_setting", "user_group", "app_user", "session", "domain", "short_link", "short_link_event"}
	for _, table := range expectedTables {
		t.Run(fmt.Sprintf("table_%s_exists", table), func(t *testing.T) {
			var exists bool
			err := database.QueryRowContext(ctx, `
				select exists (
					select 1
					from information_schema.tables
					where table_schema = 'public' and table_name = $1
				)
			`, table).Scan(&exists)
			if err != nil {
				t.Fatalf("query table existence: %v", err)
			}
			if !exists {
				t.Fatalf("expected table %s to exist", table)
			}
		})
	}

	insertUserGroups(t, ctx, database)

	_, err := database.ExecContext(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values
			('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.com', 'active', now(), now()),
			('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.org', 'active', now(), now())
	`)
	if err == nil {
		t.Fatal("expected duplicate slug to violate unique constraint")
	}
}

func TestShortLinkExperienceMigrationUpgradesExistingDataAndRollsBack(t *testing.T) {
	ctx := context.Background()
	database := migrationTestDatabase(t, ctx)
	migrationsDir := filepath.Join("..", "..", "migrations")

	if err := goose.UpTo(database, migrationsDir, 3); err != nil {
		t.Fatalf("run migrations through version 3: %v", err)
	}

	_, err := database.ExecContext(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values
			('00000000-0000-0000-0000-000000000001', 'guest', 'Guest', '', '[]'::jsonb, true, now(), now()),
			('00000000-0000-0000-0000-000000000002', 'user', 'User', '', '["short_link:create","short_link:use_intermediate"]'::jsonb, true, now(), now()),
			('00000000-0000-0000-0000-000000000003', 'admin', 'Admin', '', '["admin:access"]'::jsonb, true, now(), now());

		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000201', 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000002', 'active', false, now(), now());

		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000101', 'go.example.com', 'Default', 'short_link', true, true, now(), now());

		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.com', 'active', now(), now());
	`)
	if err != nil {
		t.Fatalf("insert existing data: %v", err)
	}

	if err := goose.UpTo(database, migrationsDir, 4); err != nil {
		t.Fatalf("upgrade through short link experience schema migration: %v", err)
	}
	assertShortLinkExperienceConstraintValidation(t, ctx, database, false)

	assertShortLinkExperienceDefaults(t, ctx, database, "00000000-0000-0000-0000-000000000301")

	_, err = database.ExecContext(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'def456', 'https://example.org', 'active', now(), now())
	`)
	if err != nil {
		t.Fatalf("insert short link using experience defaults: %v", err)
	}
	assertShortLinkExperienceDefaults(t, ctx, database, "00000000-0000-0000-0000-000000000302")

	assertGroupPermissions(t, ctx, database, "guest", false)
	assertGroupPermissions(t, ctx, database, "user", true)
	assertGroupPermissions(t, ctx, database, "admin", true)

	assertShortLinkExperienceConstraints(t, ctx, database)
	assertShortLinkExpirationRoundTrip(t, ctx, database)

	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("validate short link experience constraints: %v", err)
	}
	assertShortLinkExperienceConstraintValidation(t, ctx, database, true)

	if err := goose.DownTo(database, migrationsDir, 3); err != nil {
		t.Fatalf("roll back short link experience migrations: %v", err)
	}

	var experienceColumnCount int
	err = database.QueryRowContext(ctx, `
		select count(*)
		from information_schema.columns
		where table_schema = 'public'
			and table_name = 'short_link'
			and column_name in ('redirect_mode', 'intermediate_delay_seconds', 'expires_at')
	`).Scan(&experienceColumnCount)
	if err != nil {
		t.Fatalf("query rolled-back columns: %v", err)
	}
	if experienceColumnCount != 0 {
		t.Fatalf("expected experience columns to be removed, found %d", experienceColumnCount)
	}

	assertGroupPermissions(t, ctx, database, "guest", false)
	assertGroupPermissions(t, ctx, database, "user", false)
	assertGroupPermissions(t, ctx, database, "admin", false)

	var retainedPermission bool
	err = database.QueryRowContext(ctx, `select permissions ? 'short_link:create' from user_group where key = 'user'`).Scan(&retainedPermission)
	if err != nil {
		t.Fatalf("query retained user permission: %v", err)
	}
	if !retainedPermission {
		t.Fatal("expected rollback to retain pre-existing permissions")
	}

	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("reapply short link experience migration: %v", err)
	}
	assertShortLinkExperienceDefaults(t, ctx, database, "00000000-0000-0000-0000-000000000301")
	assertShortLinkExperienceDefaults(t, ctx, database, "00000000-0000-0000-0000-000000000302")
	assertGroupPermissions(t, ctx, database, "guest", false)
	assertGroupPermissions(t, ctx, database, "user", true)
	assertGroupPermissions(t, ctx, database, "admin", true)
	assertShortLinkExperienceConstraints(t, ctx, database)
	assertShortLinkExperienceConstraintValidation(t, ctx, database, true)
}

func migrationTestDatabase(t *testing.T, ctx context.Context) *sql.DB {
	t.Helper()

	container, err := postgres.Run(ctx,
		"postgres:18-alpine",
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

	connectionString, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	database, err := sql.Open("pgx", connectionString)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}

	return database
}

func assertGroupPermissions(t *testing.T, ctx context.Context, database *sql.DB, groupKey string, expected bool) {
	t.Helper()

	var intermediateCount int
	var expirationCount int
	err := database.QueryRowContext(ctx, `
		select
			count(*) filter (where permission.value = 'short_link:use_intermediate'),
			count(*) filter (where permission.value = 'short_link:set_expiration')
		from user_group
		left join lateral jsonb_array_elements_text(permissions) as permission(value) on true
		where key = $1
	`, groupKey).Scan(&intermediateCount, &expirationCount)
	if err != nil {
		t.Fatalf("query %s group permissions: %v", groupKey, err)
	}
	expectedCount := 0
	if expected {
		expectedCount = 1
	}
	if intermediateCount != expectedCount {
		t.Fatalf("expected %s intermediate permission count %d, got %d", groupKey, expectedCount, intermediateCount)
	}
	if expirationCount != expectedCount {
		t.Fatalf("expected %s expiration permission count %d, got %d", groupKey, expectedCount, expirationCount)
	}
}

func assertShortLinkExperienceDefaults(t *testing.T, ctx context.Context, database *sql.DB, shortLinkID string) {
	t.Helper()

	var redirectMode string
	var intermediateDelay int
	var expiresAt sql.NullTime
	err := database.QueryRowContext(ctx, `
		select redirect_mode, intermediate_delay_seconds, expires_at
		from short_link
		where id = $1
	`, shortLinkID).Scan(&redirectMode, &intermediateDelay, &expiresAt)
	if err != nil {
		t.Fatalf("query short link experience defaults: %v", err)
	}
	if redirectMode != "direct" {
		t.Fatalf("expected redirect mode direct, got %s", redirectMode)
	}
	if intermediateDelay != 5 {
		t.Fatalf("expected intermediate delay 5, got %d", intermediateDelay)
	}
	if expiresAt.Valid {
		t.Fatalf("expected expires_at to be null, got %v", expiresAt.Time)
	}
}

func assertShortLinkExperienceConstraints(t *testing.T, ctx context.Context, database *sql.DB) {
	t.Helper()

	const shortLinkID = "00000000-0000-0000-0000-000000000301"
	if _, err := database.ExecContext(ctx, `update short_link set redirect_mode = 'intermediate' where id = $1`, shortLinkID); err != nil {
		t.Fatalf("set valid intermediate redirect mode: %v", err)
	}
	if _, err := database.ExecContext(ctx, `update short_link set redirect_mode = 'invalid' where id = $1`, shortLinkID); err == nil {
		t.Fatal("expected invalid redirect mode to violate check constraint")
	}
	if _, err := database.ExecContext(ctx, `update short_link set redirect_mode = null where id = $1`, shortLinkID); err == nil {
		t.Fatal("expected null redirect mode to violate not-null constraint")
	}
	for _, delay := range []int{3, 10} {
		if _, err := database.ExecContext(ctx, `update short_link set intermediate_delay_seconds = $1 where id = $2`, delay, shortLinkID); err != nil {
			t.Fatalf("set valid intermediate delay %d: %v", delay, err)
		}
	}
	for _, delay := range []int{2, 11} {
		if _, err := database.ExecContext(ctx, `update short_link set intermediate_delay_seconds = $1 where id = $2`, delay, shortLinkID); err == nil {
			t.Fatalf("expected intermediate delay %d to violate check constraint", delay)
		}
	}
	if _, err := database.ExecContext(ctx, `update short_link set intermediate_delay_seconds = null where id = $1`, shortLinkID); err == nil {
		t.Fatal("expected null intermediate delay to violate not-null constraint")
	}
}

func assertShortLinkExperienceConstraintValidation(t *testing.T, ctx context.Context, database *sql.DB, expected bool) {
	t.Helper()

	rows, err := database.QueryContext(ctx, `
		select conname, convalidated
		from pg_constraint
		where conname in ('short_link_redirect_mode_check', 'short_link_intermediate_delay_check')
		order by conname
	`)
	if err != nil {
		t.Fatalf("query short link experience constraint validation: %v", err)
	}
	defer func() {
		_ = rows.Close()
	}()

	count := 0
	for rows.Next() {
		var name string
		var validated bool
		if err := rows.Scan(&name, &validated); err != nil {
			t.Fatalf("scan short link experience constraint validation: %v", err)
		}
		if validated != expected {
			t.Fatalf("expected constraint %s validation to be %t, got %t", name, expected, validated)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate short link experience constraints: %v", err)
	}
	if count != 2 {
		t.Fatalf("expected 2 short link experience constraints, got %d", count)
	}
}

func assertShortLinkExpirationRoundTrip(t *testing.T, ctx context.Context, database *sql.DB) {
	t.Helper()

	const shortLinkID = "00000000-0000-0000-0000-000000000301"
	expiresAt := time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC)
	if _, err := database.ExecContext(ctx, `update short_link set expires_at = $1 where id = $2`, expiresAt, shortLinkID); err != nil {
		t.Fatalf("set short link expiration: %v", err)
	}

	var stored time.Time
	var dataType string
	err := database.QueryRowContext(ctx, `
		select short_link.expires_at, columns.data_type
		from short_link
		cross join information_schema.columns
		where short_link.id = $1
			and columns.table_schema = 'public'
			and columns.table_name = 'short_link'
			and columns.column_name = 'expires_at'
	`, shortLinkID).Scan(&stored, &dataType)
	if err != nil {
		t.Fatalf("query short link expiration: %v", err)
	}
	if !stored.Equal(expiresAt) {
		t.Fatalf("expected expiration %s, got %s", expiresAt, stored)
	}
	if dataType != "timestamp with time zone" {
		t.Fatalf("expected timestamptz expiration column, got %s", dataType)
	}

	if _, err := database.ExecContext(ctx, `update short_link set expires_at = null where id = $1`, shortLinkID); err != nil {
		t.Fatalf("clear short link expiration: %v", err)
	}
}

// insertUserGroups inserts the fixed groups required by migration assertions.
func insertUserGroups(t *testing.T, ctx context.Context, database *sql.DB) {
	t.Helper()

	_, err := database.ExecContext(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now());

		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000201', 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now());

		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000101', 'go.example.com', 'Default', 'short_link', true, true, now(), now());
	`)
	if err != nil {
		t.Fatalf("insert prerequisite rows: %v", err)
	}
}
