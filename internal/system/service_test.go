package system_test

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestServiceSetupInitializesBuiltInData(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)

	service := system.NewService(pool)

	initialized, err := service.IsInitialized(ctx)
	if err != nil {
		t.Fatalf("check initialized before setup: %v", err)
	}
	if initialized {
		t.Fatal("expected new database to be uninitialized")
	}

	err = service.Setup(ctx, system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if err != nil {
		t.Fatalf("setup: %v", err)
	}

	initialized, err = service.IsInitialized(ctx)
	if err != nil {
		t.Fatalf("check initialized after setup: %v", err)
	}
	if !initialized {
		t.Fatal("expected setup to mark system initialized")
	}

	assertBuiltInData(t, ctx, pool)

	err = service.Setup(ctx, system.SetupInput{
		AdminUsername:   "admin2",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrAlreadyInitialized) {
		t.Fatalf("expected ErrAlreadyInitialized, got %v", err)
	}
}

func TestServiceSetupRejectsReservedAdminUsername(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)

	service := system.NewService(pool)

	err := service.Setup(ctx, system.SetupInput{
		AdminUsername:   "guest",
		AdminPassword:   "secure-password",
		AdminNickname:   "Guest Admin",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrInvalidSetupInput) {
		t.Fatalf("expected ErrInvalidSetupInput, got %v", err)
	}
}

func TestServiceSetupRejectsBlankRequiredFields(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool)

	err := service.Setup(ctx, system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrInvalidSetupInput) {
		t.Fatalf("expected ErrInvalidSetupInput, got %v", err)
	}
}

func TestServiceReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool)
	pool.Close()

	_, err := service.IsInitialized(ctx)
	if err == nil {
		t.Fatal("expected initialized database error")
	}

	err = service.Setup(ctx, system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if err == nil {
		t.Fatal("expected setup database error")
	}
}

func assertBuiltInData(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	var groupCount int
	err := pool.QueryRow(ctx, `select count(*) from user_group where key in ('guest', 'user', 'admin')`).Scan(&groupCount)
	if err != nil {
		t.Fatalf("count groups: %v", err)
	}
	if groupCount != 3 {
		t.Fatalf("expected 3 built-in groups, got %d", groupCount)
	}

	assertStoredGroupPermission(t, ctx, pool, permission.GroupGuest, permission.ShortLinkUseIntermediate, false)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupGuest, permission.ShortLinkSetExpiration, false)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupGuest, permission.ShortLinkSetPassword, false)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupUser, permission.ShortLinkUseIntermediate, true)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupUser, permission.ShortLinkSetExpiration, true)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupUser, permission.ShortLinkSetPassword, true)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupAdmin, permission.ShortLinkUseIntermediate, true)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupAdmin, permission.ShortLinkSetExpiration, true)
	assertStoredGroupPermission(t, ctx, pool, permission.GroupAdmin, permission.ShortLinkSetPassword, true)

	var guestPassword sql.NullString
	var guestGroup string
	err = pool.QueryRow(ctx, `
		select app_user.password_hash, user_group.key
		from app_user
		join user_group on user_group.id = app_user.group_id
		where app_user.username = 'guest' and app_user.builtin = true
	`).Scan(&guestPassword, &guestGroup)
	if err != nil {
		t.Fatalf("get guest user: %v", err)
	}
	if guestPassword.Valid {
		t.Fatal("expected guest password hash to be null")
	}
	if guestGroup != "guest" {
		t.Fatalf("expected guest group, got %s", guestGroup)
	}

	var adminHash string
	var adminGroup string
	err = pool.QueryRow(ctx, `
		select app_user.password_hash, user_group.key
		from app_user
		join user_group on user_group.id = app_user.group_id
		where app_user.username = 'admin'
	`).Scan(&adminHash, &adminGroup)
	if err != nil {
		t.Fatalf("get admin user: %v", err)
	}
	if adminHash == "" || adminHash == "secure-password" {
		t.Fatal("expected admin password to be hashed")
	}
	if adminGroup != "admin" {
		t.Fatalf("expected admin group, got %s", adminGroup)
	}

	var defaultHost string
	err = pool.QueryRow(ctx, `select host from domain where enabled = true and is_default = true`).Scan(&defaultHost)
	if err != nil {
		t.Fatalf("get default domain: %v", err)
	}
	if defaultHost != "go.example.com" {
		t.Fatalf("expected default domain go.example.com, got %s", defaultHost)
	}
}

func assertStoredGroupPermission(t *testing.T, ctx context.Context, pool *pgxpool.Pool, groupKey string, permissionName string, expected bool) {
	t.Helper()

	var hasPermission bool
	err := pool.QueryRow(ctx, `select permissions ? $1 from user_group where key = $2`, permissionName, groupKey).Scan(&hasPermission)
	if err != nil {
		t.Fatalf("query %s group permission %s: %v", groupKey, permissionName, err)
	}
	if hasPermission != expected {
		t.Fatalf("expected %s group permission %s to be %t, got %t", groupKey, permissionName, expected, hasPermission)
	}
}

func systemTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	return testdb.ProjectMigratedPool(ctx, t)
}
