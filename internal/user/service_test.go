package user_test

import (
	"context"
	"errors"
	"strings"
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

	_, err = pool.Exec(ctx, `alter table app_user rename to broken_app_user`)
	if err != nil {
		t.Fatalf("rename app_user: %v", err)
	}
	_, err = service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
	if err == nil {
		t.Fatal("expected create app user error")
	}
}

func TestServiceCreateReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	pool.Close()
	_, err := service.Create(ctx, admin, user.CreateInput{Username: "alice", Password: "secure-password", Nickname: "Alice", GroupKey: "user", Status: "active"})
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

	normalized, err := service.List(ctx, admin, user.ListInput{Page: -1, PageSize: 999})
	if err != nil {
		t.Fatalf("list users normalized max: %v", err)
	}
	if normalized.Page != 1 || normalized.PageSize != 100 {
		t.Fatalf("unexpected normalized max pagination: %#v", normalized)
	}

	defaulted, err := service.List(ctx, admin, user.ListInput{Page: 1, PageSize: -1})
	if err != nil {
		t.Fatalf("list users default page size: %v", err)
	}
	if defaulted.PageSize != 20 {
		t.Fatalf("expected default page size 20, got %d", defaulted.PageSize)
	}
}

func TestServiceListUsersReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `alter table user_group rename to broken_user_group`)
	if err != nil {
		t.Fatalf("rename user_group: %v", err)
	}
	_, err = service.List(ctx, admin, user.ListInput{Page: 1, PageSize: 20})
	if err == nil {
		t.Fatal("expected list app users error")
	}
}

func TestServiceListUsersReturnsCountError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())
	pool.Close()

	_, err := service.List(ctx, admin, user.ListInput{Page: 1, PageSize: 20})
	if err == nil {
		t.Fatal("expected count users error")
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

func TestServiceUpdateRejectsInvalidInputPermissionAndMissingUser(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}
	service := user.NewService(pool, permission.NewService())

	_, err := service.Update(ctx, regular, user.UpdateInput{ID: "00000000-0000-0000-0000-000000000701", Nickname: "Alice", Status: "active"})
	if !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	_, err = service.Update(ctx, admin, user.UpdateInput{ID: "", Nickname: "Alice", Status: "active"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}

	_, err = service.Update(ctx, admin, user.UpdateInput{ID: "bad-id", Nickname: "Alice", Status: "active"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for bad id, got %v", err)
	}

	_, err = service.Update(ctx, admin, user.UpdateInput{ID: "00000000-0000-0000-0000-000000000701", Nickname: "Alice", Status: "active"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

func TestServiceUpdateReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())
	pool.Close()

	_, err := service.Update(ctx, admin, user.UpdateInput{ID: "00000000-0000-0000-0000-000000000701", Nickname: "Alice", Status: "active"})
	if err == nil {
		t.Fatal("expected get user database error")
	}
}

func TestServiceUpdateReturnsMutationAndGroupLookupErrors(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `
		create function skip_app_user_update() returns trigger language plpgsql as $$
		begin
			return null;
		end;
		$$;
		create trigger skip_app_user_update_trigger before update on app_user
		for each row execute function skip_app_user_update();
	`)
	if err != nil {
		t.Fatalf("create skip trigger: %v", err)
	}
	_, err = service.Update(ctx, admin, user.UpdateInput{ID: aliceID, Nickname: "Alice Renamed", Status: "disabled"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound from skipped update, got %v", err)
	}
	_, err = pool.Exec(ctx, `
		drop trigger skip_app_user_update_trigger on app_user;
		drop function skip_app_user_update();
		create function fail_app_user_update() returns trigger language plpgsql as $$
		begin
			raise exception 'profile update failed';
		end;
		$$;
		create trigger fail_app_user_update_trigger before update on app_user
		for each row execute function fail_app_user_update();
	`)
	if err != nil {
		t.Fatalf("create fail trigger: %v", err)
	}
	_, err = service.Update(ctx, admin, user.UpdateInput{ID: aliceID, Nickname: "Alice Renamed", Status: "disabled"})
	if err == nil {
		t.Fatal("expected update profile error")
	}
}

func TestServiceUpdateReturnsGroupLookupError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `alter table app_user drop constraint app_user_group_id_fkey`)
	if err != nil {
		t.Fatalf("drop group constraint: %v", err)
	}
	_, err = pool.Exec(ctx, `update app_user set group_id = '00000000-0000-0000-0000-000000009999' where id = $1`, aliceID)
	if err != nil {
		t.Fatalf("orphan user group: %v", err)
	}

	_, err = service.Update(ctx, admin, user.UpdateInput{ID: aliceID, Nickname: "Alice Renamed", Status: "disabled"})
	if err == nil {
		t.Fatal("expected group lookup error")
	}
}

func TestServiceUpdateProfileUpdatesOwnNickname(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	userID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	actor := auth.CurrentUser{
		ID:          userID,
		Username:    "alice",
		Nickname:    "Alice",
		GroupKey:    "user",
		Permissions: permission.UserPermissions,
	}
	service := user.NewService(pool, permission.NewService())

	result, err := service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: "Alice Renamed"})
	if err != nil {
		t.Fatalf("update profile: %v", err)
	}
	if result.User.ID != userID {
		t.Fatalf("unexpected user id: %#v", result.User)
	}
	if result.User.Username != "alice" || result.User.Nickname != "Alice Renamed" {
		t.Fatalf("unexpected user: %#v", result.User)
	}
	if result.User.GroupKey != "user" {
		t.Fatalf("unexpected group: %#v", result.User)
	}
	if !containsString(result.User.Permissions, permission.ShortLinkReadOwn) {
		t.Fatalf("expected permissions to include read own, got %#v", result.User.Permissions)
	}

	var storedNickname string
	err = pool.QueryRow(ctx, `select nickname from app_user where id = $1`, userID).Scan(&storedNickname)
	if err != nil {
		t.Fatalf("query stored nickname: %v", err)
	}
	if storedNickname != "Alice Renamed" {
		t.Fatalf("unexpected stored nickname: %q", storedNickname)
	}
}

func TestServiceUpdateProfileRejectsPermissionInputBuiltinAndMissingUser(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user", Permissions: permission.UserPermissions}
	guest := auth.CurrentUser{Username: "guest", GroupKey: "guest"}
	builtinID := insertAppUser(t, ctx, pool, "system", "hash", "System", "user", "active", true)
	service := user.NewService(pool, permission.NewService())

	_, err := service.UpdateProfile(ctx, guest, user.UpdateProfileInput{Nickname: "Visitor"})
	if !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	_, err = service.UpdateProfile(ctx, regular, user.UpdateProfileInput{Nickname: "   "})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}

	_, err = service.UpdateProfile(ctx, auth.CurrentUser{
		ID:          "bad-id",
		Username:    "bad",
		GroupKey:    "user",
		Permissions: permission.UserPermissions,
	}, user.UpdateProfileInput{Nickname: "Bad"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for bad id, got %v", err)
	}

	_, err = service.UpdateProfile(ctx, auth.CurrentUser{ID: builtinID, Username: "system", GroupKey: "user", Permissions: permission.UserPermissions}, user.UpdateProfileInput{Nickname: "System Renamed"})
	if !errors.Is(err, user.ErrBuiltinUserImmutable) {
		t.Fatalf("expected ErrBuiltinUserImmutable, got %v", err)
	}

	_, err = service.UpdateProfile(ctx, auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000701", Username: "missing", GroupKey: "user", Permissions: permission.UserPermissions}, user.UpdateProfileInput{Nickname: "Missing"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

func TestServiceUpdateProfileRejectsTooLongNickname(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	userID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	actor := auth.CurrentUser{
		ID:          userID,
		Username:    "alice",
		Nickname:    "Alice",
		GroupKey:    "user",
		Permissions: permission.UserPermissions,
	}
	service := user.NewService(pool, permission.NewService())

	longNickname := strings.Repeat("a", user.NicknameMaxLength+1)
	_, err := service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: longNickname})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for too long nickname, got %v", err)
	}
}

func TestServiceUpdateProfileReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	userID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	actor := auth.CurrentUser{
		ID:          userID,
		Username:    "alice",
		Nickname:    "Alice",
		GroupKey:    "user",
		Permissions: permission.UserPermissions,
	}
	service := user.NewService(pool, permission.NewService())

	pool.Close()
	_, err := service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: "Alice Renamed"})
	if err == nil {
		t.Fatal("expected update profile database error")
	}
}

func TestServiceUpdateProfileReturnsMissingWhenUpdateSkipsRow(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	userID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	actor := auth.CurrentUser{
		ID:          userID,
		Username:    "alice",
		Nickname:    "Alice",
		GroupKey:    "user",
		Permissions: permission.UserPermissions,
	}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `
		create function skip_app_user_nickname_update() returns trigger language plpgsql as $$
		begin
			return null;
		end;
		$$;
		create trigger skip_app_user_nickname_update_trigger before update of nickname on app_user
		for each row execute function skip_app_user_nickname_update();
	`)
	if err != nil {
		t.Fatalf("create skip trigger: %v", err)
	}

	_, err = service.UpdateProfile(ctx, actor, user.UpdateProfileInput{Nickname: "Alice Renamed"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound from skipped nickname update, got %v", err)
	}
}

func TestServiceUpdateProfileReturnsMutationGroupAndPermissionErrors(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	bobID := insertAppUser(t, ctx, pool, "bob", "hash", "Bob", "user", "active", false)
	carolID := insertAppUser(t, ctx, pool, "carol", "hash", "Carol", "user", "active", false)
	service := user.NewService(pool, permission.NewService())
	actor := func(id string, username string) auth.CurrentUser {
		return auth.CurrentUser{
			ID:          id,
			Username:    username,
			Nickname:    username,
			GroupKey:    "user",
			Permissions: permission.UserPermissions,
		}
	}

	_, err := pool.Exec(ctx, `
		create function fail_app_user_nickname_update() returns trigger language plpgsql as $$
		begin
			raise exception 'nickname update failed';
		end;
		$$;
		create trigger fail_app_user_nickname_update_trigger before update of nickname on app_user
		for each row execute function fail_app_user_nickname_update();
	`)
	if err != nil {
		t.Fatalf("create nickname fail trigger: %v", err)
	}
	_, err = service.UpdateProfile(ctx, actor(aliceID, "alice"), user.UpdateProfileInput{Nickname: "Alice Renamed"})
	if err == nil {
		t.Fatal("expected nickname update error")
	}

	_, err = pool.Exec(ctx, `
		drop trigger fail_app_user_nickname_update_trigger on app_user;
		drop function fail_app_user_nickname_update();
	`)
	if err != nil {
		t.Fatalf("drop nickname fail trigger: %v", err)
	}
	_, err = pool.Exec(ctx, `alter table app_user drop constraint app_user_group_id_fkey`)
	if err != nil {
		t.Fatalf("drop group constraint: %v", err)
	}
	_, err = pool.Exec(ctx, `update app_user set group_id = '00000000-0000-0000-0000-000000009999' where id = $1`, bobID)
	if err != nil {
		t.Fatalf("orphan user group: %v", err)
	}
	_, err = service.UpdateProfile(ctx, actor(bobID, "bob"), user.UpdateProfileInput{Nickname: "Bob Renamed"})
	if err == nil {
		t.Fatal("expected group lookup error")
	}

	_, err = pool.Exec(ctx, `update user_group set permissions = '{"bad": true}'::jsonb where key = 'user'`)
	if err != nil {
		t.Fatalf("break user group permissions: %v", err)
	}
	_, err = service.UpdateProfile(ctx, actor(carolID, "carol"), user.UpdateProfileInput{Nickname: "Carol Renamed"})
	if err == nil {
		t.Fatal("expected permissions decode error")
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

func TestServiceResetPasswordRejectsInvalidInputPermissionAndMissingUser(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}
	service := user.NewService(pool, permission.NewService())

	err := service.ResetPassword(ctx, regular, user.ResetPasswordInput{ID: "00000000-0000-0000-0000-000000000701", Password: "new-password"})
	if !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: "", Password: "new-password"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}

	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: "bad-id", Password: "new-password"})
	if !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for bad id, got %v", err)
	}

	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: "00000000-0000-0000-0000-000000000701", Password: "new-password"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound, got %v", err)
	}
}

func TestServiceResetPasswordReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())
	pool.Close()

	err := service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: "00000000-0000-0000-0000-000000000701", Password: "new-password"})
	if err == nil {
		t.Fatal("expected get user database error")
	}
}

func TestServiceResetPasswordReturnsMutationErrors(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `
		create function fail_app_user_password_update() returns trigger language plpgsql as $$
		begin
			raise exception 'password update failed';
		end;
		$$;
		create trigger fail_app_user_password_update_trigger before update of password_hash on app_user
		for each row execute function fail_app_user_password_update();
	`)
	if err != nil {
		t.Fatalf("create password fail trigger: %v", err)
	}
	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: aliceID, Password: "new-password"})
	if err == nil {
		t.Fatal("expected password update error")
	}
}

func TestServiceResetPasswordReturnsMissingWhenUpdateSkipsRow(t *testing.T) {
	ctx := context.Background()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	aliceID := insertAppUser(t, ctx, pool, "alice", "hash", "Alice", "user", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := user.NewService(pool, permission.NewService())

	_, err := pool.Exec(ctx, `
		create function skip_app_user_password_update() returns trigger language plpgsql as $$
		begin
			return null;
		end;
		$$;
		create trigger skip_app_user_password_update_trigger before update of password_hash on app_user
		for each row execute function skip_app_user_password_update();
	`)
	if err != nil {
		t.Fatalf("create password skip trigger: %v", err)
	}
	err = service.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: aliceID, Password: "new-password"})
	if !errors.Is(err, user.ErrUserNotFound) {
		t.Fatalf("expected ErrUserNotFound from skipped password update, got %v", err)
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

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
