package auth_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestSessionServiceCreatesReadsAndRevokesSession(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedAuthDatabaseURL(t, ctx)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	userID := "00000000-0000-0000-0000-000000000201"
	insertAuthUser(t, ctx, pool, userID)

	service := auth.NewSessionService(pool, 24*time.Hour)

	session, err := service.Create(ctx, userID)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected session id")
	}
	if !session.ExpiresAt.After(time.Now()) {
		t.Fatal("expected future expiration")
	}

	resolved, err := service.Resolve(ctx, session.ID)
	if err != nil {
		t.Fatalf("resolve session: %v", err)
	}
	if resolved.UserID != userID {
		t.Fatalf("expected user id %s, got %s", userID, resolved.UserID)
	}

	if err := service.Revoke(ctx, session.ID); err != nil {
		t.Fatalf("revoke session: %v", err)
	}

	_, err = service.Resolve(ctx, session.ID)
	if err == nil {
		t.Fatal("expected revoked session to be rejected")
	}
}

func insertAuthUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) {
	t.Helper()

	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now());
	`)
	if err != nil {
		t.Fatalf("insert auth group: %v", err)
	}

	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now());
	`, userID)
	if err != nil {
		t.Fatalf("insert auth user: %v", err)
	}
}

func migratedAuthDatabaseURL(t *testing.T, ctx context.Context) string {
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
