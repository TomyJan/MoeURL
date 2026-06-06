package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAuthServiceLoginCreatesSession(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")

	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if result.Session.ID == "" {
		t.Fatal("expected session id")
	}
	if result.User.Username != "alice" {
		t.Fatalf("expected alice, got %s", result.User.Username)
	}
	if result.User.GroupKey != "user" {
		t.Fatalf("expected user group, got %s", result.User.GroupKey)
	}
}

func TestAuthServiceRejectsWrongPasswordAndDisabledUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	insertLoginUser(t, ctx, pool, "disabled", "correct-password", "disabled")

	service := auth.NewService(pool, 24*time.Hour)

	_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "disabled", Password: "correct-password"})
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
}

func insertLoginGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '["short_link:create"]'::jsonb, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert login group: %v", err)
	}
}

func insertLoginUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, password string, status string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, $2, $1, '00000000-0000-0000-0000-000000000001', $3, false, now(), now())
	`, username, hash, status)
	if err != nil {
		t.Fatalf("insert login user: %v", err)
	}
}

func authTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := migratedAuthDatabaseURL(t, ctx)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
