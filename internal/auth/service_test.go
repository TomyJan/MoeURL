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

func TestAuthServiceMeLogoutAndResolveCurrentUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	guest, err := service.Me(ctx, "")
	if err != nil {
		t.Fatalf("me without session: %v", err)
	}
	if guest.Username != "guest" {
		t.Fatalf("expected guest, got %#v", guest)
	}

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	current, err := service.ResolveCurrentUser(ctx, result.Session.ID)
	if err != nil {
		t.Fatalf("resolve current user: %v", err)
	}
	if current.Username != "alice" {
		t.Fatalf("expected alice, got %s", current.Username)
	}

	if err := service.Logout(ctx, ""); err != nil {
		t.Fatalf("logout without session: %v", err)
	}
	if err := service.Logout(ctx, result.Session.ID); err != nil {
		t.Fatalf("logout: %v", err)
	}

	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("expected ErrInvalidSession, got %v", err)
	}
}

func TestAuthServiceMeRejectsDisabledSessionUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_, err = pool.Exec(ctx, `update app_user set status = 'disabled' where username = 'alice'`)
	if err != nil {
		t.Fatalf("disable user: %v", err)
	}

	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
}

func TestAuthServiceFindUserErrorBranches(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	insertLoginUserWithoutPassword(t, ctx, pool, "system")
	service := auth.NewService(pool, 24*time.Hour)

	_, err := service.Login(ctx, auth.LoginInput{Username: "missing", Password: "password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for missing user, got %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "system", Password: "password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for system user, got %v", err)
	}

	_, err = pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`)
	if err != nil {
		t.Fatalf("break permissions shape: %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err == nil {
		t.Fatal("expected permissions decode error")
	}
}

func TestAuthServiceFindUserByIDErrorBranches(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	_, err = pool.Exec(ctx, `update app_user set deleted_at = now() where username = 'alice'`)
	if err != nil {
		t.Fatalf("soft delete user: %v", err)
	}
	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}

	_, err = pool.Exec(ctx, `update app_user set deleted_at = null where username = 'alice'`)
	if err != nil {
		t.Fatalf("restore user: %v", err)
	}
	result, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	_, err = pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`)
	if err != nil {
		t.Fatalf("break permissions shape: %v", err)
	}
	_, err = service.Me(ctx, result.Session.ID)
	if err == nil {
		t.Fatal("expected permissions decode error")
	}
}

func TestAuthServiceReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	pool.Close()

	_, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err == nil {
		t.Fatal("expected login database error")
	}

	_, err = service.Me(ctx, result.Session.ID)
	if err == nil {
		t.Fatal("expected me database error")
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

func insertLoginUserWithoutPassword(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, null, $1, '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, username)
	if err != nil {
		t.Fatalf("insert login user without password: %v", err)
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
