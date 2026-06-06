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

func TestInitialMigrationCreatesCoreTablesAndConstraints(t *testing.T) {
	ctx := context.Background()
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

	migrationsDir := filepath.Join("..", "..", "migrations")
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	expectedTables := []string{"system_setting", "user_group", "app_user", "session", "domain", "short_link"}
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

	_, err = database.ExecContext(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values
			('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.com', 'active', now(), now()),
			('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'abc123', 'https://example.org', 'active', now(), now())
	`)
	if err == nil {
		t.Fatal("expected duplicate slug to violate unique constraint")
	}
}

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
