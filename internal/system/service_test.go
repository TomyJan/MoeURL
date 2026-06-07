package system_test

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

func TestServiceSetupInitializesBuiltInData(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedDatabaseURL(t, ctx)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

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
	databaseURL := migratedDatabaseURL(t, ctx)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	service := system.NewService(pool)

	err = service.Setup(ctx, system.SetupInput{
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

func migratedDatabaseURL(t *testing.T, ctx context.Context) string {
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
