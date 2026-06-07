package user_test

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
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

func TestServiceListUsersRequiresAdminAccess(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}
	service := user.NewService(pool, permission.NewService())

	_, err := service.List(ctx, regular, user.ListInput{Page: 1, PageSize: 20})
	if !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

func TestServiceListUsersReturnsUserSummaries(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	insertAppUser(t, ctx, pool, "guest", "", "Guest", "user", "active", true)
	insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	result, err := service.List(ctx, admin, user.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list users: %v", err)
	}
	if result.Total != 2 {
		t.Fatalf("expected total 2, got %d", result.Total)
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected 2 users, got %d", len(result.Items))
	}
	if result.Items[0].Username != "alice" || result.Items[0].Group != "user" || result.Items[0].Builtin {
		t.Fatalf("unexpected first user: %#v", result.Items[0])
	}
	if result.Items[1].Username != "guest" || !result.Items[1].Builtin {
		t.Fatalf("unexpected second user: %#v", result.Items[1])
	}
}

func TestServiceUpdateRejectsBuiltinUserAndUpdatesRegularUser(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	guestID := insertAppUser(t, ctx, pool, "guest", "", "Guest", "user", "active", true)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := service.Update(ctx, admin, user.UpdateInput{ID: guestID, Nickname: "Visitor", Status: "disabled"})
	if !errors.Is(err, user.ErrBuiltinUserImmutable) {
		t.Fatalf("expected ErrBuiltinUserImmutable, got %v", err)
	}

	result, err := service.Update(ctx, admin, user.UpdateInput{ID: aliceID, Nickname: "Alice Renamed", Status: "disabled"})
	if err != nil {
		t.Fatalf("update user: %v", err)
	}
	if result.User.Nickname != "Alice Renamed" || result.User.Status != "disabled" {
		t.Fatalf("unexpected updated user: %#v", result.User)
	}
}

func TestServiceResetPasswordRejectsBuiltinUserAndChangesPasswordHash(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	guestID := insertAppUser(t, ctx, pool, "guest", "", "Guest", "user", "active", true)
	oldHash, err := auth.HashPassword("old-password")
	if err != nil {
		t.Fatalf("hash old password: %v", err)
	}
	aliceID := insertAppUser(t, ctx, pool, "alice", oldHash, "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: guestID, Password: "new-password"})
	if !errors.Is(err, user.ErrBuiltinUserImmutable) {
		t.Fatalf("expected ErrBuiltinUserImmutable, got %v", err)
	}

	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: aliceID, Password: "new-password"})
	if err != nil {
		t.Fatalf("reset password: %v", err)
	}
	var newHash string
	err = pool.QueryRow(ctx, `select password_hash from app_user where username = 'alice'`).Scan(&newHash)
	if err != nil {
		t.Fatalf("query updated hash: %v", err)
	}
	if auth.VerifyPassword("old-password", newHash) {
		t.Fatal("old password should not verify")
	}
	if !auth.VerifyPassword("new-password", newHash) {
		t.Fatal("new password should verify")
	}
}

func insertAppUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, passwordHash string, nickname string, groupKey string, status string, builtin bool) string {
	t.Helper()
	var id string
	err := pool.QueryRow(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		select gen_random_uuid(), $1, $2, $3, user_group.id, $4, $5, now(), now()
		from user_group
		where user_group.key = $6
		returning id::text
	`, username, nullableText(passwordHash), nickname, status, builtin, groupKey).Scan(&id)
	if err != nil {
		t.Fatalf("insert app user: %v", err)
	}
	return id
}

func nullableText(value string) pgtype.Text {
	if value == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: value, Valid: true}
}
