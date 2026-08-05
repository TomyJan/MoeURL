package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const localAdminDatabaseURL = "postgres://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable"

type cleanupErrorReporter interface {
	Errorf(format string, args ...any)
}

func reportCleanupError(reporter cleanupErrorReporter, operation string, err error) {
	if err != nil {
		reporter.Errorf("%s: %v", operation, err)
	}
}

// DatabaseURL returns a fresh PostgreSQL URL for tests.
// It prefers Docker when available and falls back to a local PostgreSQL
// instance when Docker cannot start on the current machine.
func DatabaseURL(t testing.TB, ctx context.Context) string {
	t.Helper()

	databaseURL, cleanup, err := dockerDatabaseURL(ctx, t)
	if err == nil {
		t.Cleanup(cleanup)
		return databaseURL
	}
	t.Logf("falling back to local PostgreSQL for tests: %v", err)

	databaseURL, cleanup, err = localDatabaseURL(ctx, t.Name(), t)
	if err != nil {
		t.Fatalf("start local PostgreSQL: %v", err)
	}
	t.Cleanup(cleanup)
	return databaseURL
}

// MigratedDatabaseURL returns a fresh PostgreSQL URL with project migrations applied.
func MigratedDatabaseURL(t testing.TB, ctx context.Context, migrationsDir string) string {
	t.Helper()

	databaseURL := DatabaseURL(t, ctx)
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		reportCleanupError(t, "close test database", database.Close())
	})

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return databaseURL
}

func dockerDatabaseURL(ctx context.Context, t testing.TB) (string, func(), error) {
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
		return "", nil, err
	}

	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil {
			return "", nil, fmt.Errorf("%w: terminate container: %v", err, terminateErr)
		}
		return "", nil, err
	}

	cleanup := func() {
		reportCleanupError(t, "terminate testcontainer", testcontainers.TerminateContainer(container))
	}

	return databaseURL, cleanup, nil
}

func localDatabaseURL(ctx context.Context, testName string, t testing.TB) (string, func(), error) {
	adminURL := os.Getenv("MOEURL_TEST_POSTGRES_ADMIN_URL")
	if adminURL == "" {
		adminURL = localAdminDatabaseURL
	}

	parsedURL, err := url.Parse(adminURL)
	if err != nil {
		return "", nil, err
	}

	databaseName := localDatabaseName(testName)
	parsedURL.Path = "/" + databaseName
	databaseURL := parsedURL.String()

	adminDatabase, err := sql.Open("pgx", adminURL)
	if err != nil {
		return "", nil, err
	}
	if _, err := adminDatabase.ExecContext(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", databaseName)); err != nil {
		_ = adminDatabase.Close()
		return "", nil, err
	}
	if _, err := adminDatabase.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", databaseName)); err != nil {
		_ = adminDatabase.Close()
		return "", nil, err
	}

	cleanup := func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		_, dropErr := adminDatabase.ExecContext(cleanupContext, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", databaseName))
		reportCleanupError(t, fmt.Sprintf("drop test database %s", databaseName), dropErr)
		reportCleanupError(t, "close test database admin connection", adminDatabase.Close())
	}

	return databaseURL, cleanup, nil
}

func localDatabaseName(testName string) string {
	sanitized := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= '0' && r <= '9':
			return r
		default:
			return '_'
		}
	}, strings.ToLower(testName))
	sanitized = strings.Trim(sanitized, "_")
	if sanitized == "" {
		sanitized = "test"
	}
	if len(sanitized) > 24 {
		sanitized = sanitized[:24]
	}
	return fmt.Sprintf("moeurl_%s_%d_%d", sanitized, os.Getpid(), time.Now().UnixNano())
}
