package system_test

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestNewSetupPolicyValidatesRequiredToken verifies invalid required policies fail during construction.
func TestNewSetupPolicyValidatesRequiredToken(t *testing.T) {
	for _, test := range []struct {
		name    string
		token   string
		wantErr bool
	}{
		{name: "missing", wantErr: true},
		{name: "whitespace", token: "   ", wantErr: true},
		{name: "31 trimmed characters", token: " " + strings.Repeat("a", 31) + " ", wantErr: true},
		{name: "32 trimmed characters", token: " " + strings.Repeat("a", 32) + " "},
		{name: "31 trimmed Unicode characters", token: " " + strings.Repeat("界", 31) + " ", wantErr: true},
		{name: "32 trimmed Unicode characters", token: " " + strings.Repeat("界", 32) + " "},
	} {
		t.Run(test.name, func(t *testing.T) {
			policy, err := system.NewSetupPolicy(true, test.token)
			if test.wantErr {
				if !errors.Is(err, system.ErrInvalidSetupPolicy) {
					t.Fatalf("policy error = %v, want ErrInvalidSetupPolicy", err)
				}
				if test.token != "" && strings.Contains(err.Error(), test.token) {
					t.Fatal("policy error exposed the setup token")
				}
				return
			}
			if err != nil {
				t.Fatalf("create setup policy: %v", err)
			}
			if !system.NewService(nil, policy).SetupTokenRequired() {
				t.Fatal("valid required policy was not marked required")
			}
		})
	}
}

// TestServiceSetupInitializesBuiltInData verifies service setup initializes built in data.
func TestServiceSetupInitializesBuiltInData(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)

	service := system.NewService(pool, mustSetupPolicy(t, false, ""))

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
		ShortLinkDomain: "https://go.example.com",
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
		ShortLinkDomain: "https://go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrAlreadyInitialized) {
		t.Fatalf("expected ErrAlreadyInitialized, got %v", err)
	}
}

// TestServiceSetupNormalizesShortLinkOrigin verifies setup stores one canonical Origin in both mirrors.
func TestServiceSetupNormalizesShortLinkOrigin(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool, mustSetupPolicy(t, false, ""))
	input := validSetupInput("")
	input.ShortLinkDomain = "https://GO.Example.com.:443/"

	if err := service.Setup(ctx, input); err != nil {
		t.Fatalf("setup: %v", err)
	}

	var domainHost string
	if err := pool.QueryRow(ctx, `select host from domain where is_default = true`).Scan(&domainHost); err != nil {
		t.Fatalf("read default domain: %v", err)
	}
	var mirroredHost string
	if err := pool.QueryRow(ctx, `select value #>> '{}' from system_setting where key = 'site.default_short_link_domain'`).Scan(&mirroredHost); err != nil {
		t.Fatalf("read default domain setting: %v", err)
	}
	if domainHost != "https://go.example.com" || mirroredHost != domainHost {
		t.Fatalf("stored domain = %q, mirrored domain = %q", domainHost, mirroredHost)
	}
}

// TestServiceSetupRejectsInvalidShortLinkOriginBeforePersistence verifies invalid Origins leave no setup data.
func TestServiceSetupRejectsInvalidShortLinkOriginBeforePersistence(t *testing.T) {
	for _, shortLinkDomain := range []string{"https://go.example.com/path", " https://go.example.com "} {
		t.Run(shortLinkDomain, func(t *testing.T) {
			ctx := t.Context()
			pool := systemTestPool(t, ctx)
			service := system.NewService(pool, mustSetupPolicy(t, false, ""))
			input := validSetupInput("")
			input.ShortLinkDomain = shortLinkDomain

			err := service.Setup(ctx, input)

			if !errors.Is(err, system.ErrInvalidSetupInput) {
				t.Fatalf("setup error = %v, want ErrInvalidSetupInput", err)
			}
			for _, table := range []string{"user_group", "app_user", "domain", "system_setting", "domain_user_group"} {
				var count int
				if err := pool.QueryRow(ctx, `select count(*) from `+table).Scan(&count); err != nil {
					t.Fatalf("count %s: %v", table, err)
				}
				if count != 0 {
					t.Fatalf("invalid setup left %d %s rows", count, table)
				}
			}
		})
	}
}

// TestServiceSetupAllowsNormalizedLoopbackHTTPInDevelopment verifies setup shares domain-management development policy.
func TestServiceSetupAllowsNormalizedLoopbackHTTPInDevelopment(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	service := system.NewServiceWithDevelopment(pool, mustSetupPolicy(t, false, ""), true)
	input := validSetupInput("")
	input.ShortLinkDomain = "http://LOCALHOST:80/"

	if err := service.Setup(ctx, input); err != nil {
		t.Fatalf("setup: %v", err)
	}

	var domainHost string
	if err := pool.QueryRow(ctx, `select host from domain where is_default = true`).Scan(&domainHost); err != nil {
		t.Fatalf("read default domain: %v", err)
	}
	if domainHost != "http://localhost" {
		t.Fatalf("stored domain = %q, want http://localhost", domainHost)
	}
}

// TestServiceSetupRejectsReservedAdminUsername verifies service setup rejects reserved admin username.
func TestServiceSetupRejectsReservedAdminUsername(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)

	service := system.NewService(pool, mustSetupPolicy(t, false, ""))

	err := service.Setup(ctx, system.SetupInput{
		AdminUsername:   "guest",
		AdminPassword:   "secure-password",
		AdminNickname:   "Guest Admin",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "https://go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrInvalidSetupInput) {
		t.Fatalf("expected ErrInvalidSetupInput, got %v", err)
	}
}

// TestServiceSetupRejectsBlankRequiredFields verifies service setup rejects blank required fields.
func TestServiceSetupRejectsBlankRequiredFields(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool, mustSetupPolicy(t, false, ""))

	err := service.Setup(ctx, system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "",
		SystemDomain:    "example.com",
		ShortLinkDomain: "https://go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if !errors.Is(err, system.ErrInvalidSetupInput) {
		t.Fatalf("expected ErrInvalidSetupInput, got %v", err)
	}
}

// TestServiceSetupValidatesRequiredToken verifies required setup tokens gate initialization.
func TestServiceSetupValidatesRequiredToken(t *testing.T) {
	const configuredToken = "configured-setup-token-0123456789"

	for _, test := range []struct {
		name    string
		token   string
		wantErr error
	}{
		{name: "wrong token", token: "wrong-token", wantErr: system.ErrInvalidSetupToken},
		{name: "correct token", token: configuredToken},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			pool := systemTestPool(t, ctx)
			service := system.NewService(pool, mustSetupPolicy(t, true, configuredToken))

			err := service.Setup(ctx, validSetupInput(test.token))
			if test.wantErr != nil {
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("setup error = %v, want %v", err, test.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("setup: %v", err)
			}
		})
	}
}

// TestServiceSetupValidatesOrdinaryInputBeforeToken verifies field errors keep priority.
func TestServiceSetupValidatesOrdinaryInputBeforeToken(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool, mustSetupPolicy(t, true, "configured-setup-token-0123456789"))
	input := validSetupInput("wrong-token")
	input.SiteName = ""

	err := service.Setup(ctx, input)

	if !errors.Is(err, system.ErrInvalidSetupInput) {
		t.Fatalf("setup error = %v, want ErrInvalidSetupInput", err)
	}
}

// TestServiceSetupChecksAlreadyInitializedBeforeToken verifies one-time setup semantics keep priority.
func TestServiceSetupChecksAlreadyInitializedBeforeToken(t *testing.T) {
	const configuredToken = "configured-setup-token-0123456789"
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool, mustSetupPolicy(t, true, configuredToken))
	if err := service.Setup(ctx, validSetupInput(configuredToken)); err != nil {
		t.Fatalf("initial setup: %v", err)
	}

	err := service.Setup(ctx, validSetupInput("wrong-token"))

	if !errors.Is(err, system.ErrAlreadyInitialized) {
		t.Fatalf("second setup error = %v, want ErrAlreadyInitialized", err)
	}
}

// TestServiceReturnsDatabaseErrors verifies service returns database errors.
func TestServiceReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := systemTestPool(t, ctx)
	service := system.NewService(pool, mustSetupPolicy(t, false, ""))
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
		ShortLinkDomain: "https://go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
	})
	if err == nil {
		t.Fatal("expected setup database error")
	}
}

// assertBuiltInData checks the database state expected by the surrounding tests.
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
	if defaultHost != "https://go.example.com" {
		t.Fatalf("expected default domain https://go.example.com, got %s", defaultHost)
	}
	var grantedGroups []string
	if err := pool.QueryRow(ctx, `
		select array_agg(user_group.key order by user_group.key)
		from domain_user_group
		join user_group on user_group.id = domain_user_group.user_group_id
		join domain on domain.id = domain_user_group.domain_id
		where domain.host = 'https://go.example.com'
	`).Scan(&grantedGroups); err != nil {
		t.Fatalf("get initial domain grants: %v", err)
	}
	if strings.Join(grantedGroups, ",") != "admin,user" {
		t.Fatalf("initial domain grants = %v, want admin and user", grantedGroups)
	}
}

// TestServiceSetupRollsBackWhenDomainGrantFails verifies setup cannot leave partial identities.
func TestServiceSetupRollsBackWhenDomainGrantFails(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	if _, err := pool.Exec(ctx, `
		create function reject_domain_grant() returns trigger language plpgsql as $$
		begin raise exception 'domain grant unavailable'; end; $$;
		create trigger reject_domain_grant before insert on domain_user_group
		for each row execute function reject_domain_grant();
	`); err != nil {
		t.Fatalf("install domain grant failure: %v", err)
	}
	service := system.NewService(pool, mustSetupPolicy(t, false, ""))
	if err := service.Setup(ctx, validSetupInput("")); err == nil {
		t.Fatal("expected domain grant failure")
	}
	for _, table := range []string{"user_group", "app_user", "domain", "system_setting", "domain_user_group"} {
		var count int
		if err := pool.QueryRow(ctx, `select count(*) from `+table).Scan(&count); err != nil {
			t.Fatalf("count rolled-back %s: %v", table, err)
		}
		if count != 0 {
			t.Fatalf("partial setup left %d %s rows", count, table)
		}
	}
}

// assertStoredGroupPermission checks the database state expected by the surrounding tests.
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

// systemTestPool opens the isolated PostgreSQL database used by its test package.
func systemTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	return testdb.ProjectMigratedPool(ctx, t)
}

// validSetupInput returns a complete setup request with the supplied deployment token.
func validSetupInput(setupToken string) system.SetupInput {
	return system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "https://go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
		SetupToken:      setupToken,
	}
}

// mustSetupPolicy creates the explicit setup policy required by service tests.
func mustSetupPolicy(t *testing.T, required bool, token string) system.SetupPolicy {
	t.Helper()
	policy, err := system.NewSetupPolicy(required, token)
	if err != nil {
		t.Fatalf("create setup policy: %v", err)
	}
	return policy
}
