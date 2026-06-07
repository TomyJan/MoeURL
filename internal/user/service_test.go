package user_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
)

func TestServiceCreateUserByAdmin(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	result, err := service.Create(ctx, admin, user.CreateInput{
		Username: "alice",
		Password: "secure-password",
		Nickname: "Alice",
		GroupKey: "user",
		Status:   "active",
	})
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	if result.User.Username != "alice" || result.User.Group != "user" {
		t.Fatalf("unexpected user: %#v", result.User)
	}

	var passwordHash string
	err = pool.QueryRow(ctx, `select password_hash from app_user where username = 'alice'`).Scan(&passwordHash)
	if err != nil {
		t.Fatalf("query created user: %v", err)
	}
	if passwordHash == "" || passwordHash == "secure-password" {
		t.Fatal("expected password hash")
	}
}

func TestServiceCreateUserRejectsPermissionAndDuplicateUsername(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := service.Create(ctx, regular, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	_, err = service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if err != nil {
		t.Fatalf("first create: %v", err)
	}
	_, err = service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if !errors.Is(err, user.ErrUsernameExists) {
		t.Fatalf("expected ErrUsernameExists, got %v", err)
	}
}

func TestServiceCreateRejectsInvalidInputAndReturnsErrors(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, nil)

	_, err := service.Create(ctx, admin, user.CreateInput{Username: "", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}

	_, err = service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "missing", Status: "active"})
	if err == nil {
		t.Fatal("expected group lookup error")
	}

	pool.Close()
	_, err = service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if err == nil {
		t.Fatal("expected database error")
	}
}
