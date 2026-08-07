package testdb

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const localAdminDatabaseURL = "postgres://postgres:postgres@127.0.0.1:5433/postgres?sslmode=disable"
const dockerProbeTimeout = 10 * time.Second
const dockerContainerStartupTimeout = 60 * time.Second

type cleanupErrorReporter interface {
	Errorf(format string, args ...any)
}

var (
	dockerProbeOnce sync.Once
	dockerProbeErr  error

	dockerContainerOnce     sync.Once
	dockerContainerInstance *postgres.PostgresContainer
	dockerContainerURL      string
	dockerContainerErr      error
)

// reportCleanupError reports best-effort cleanup failures without hiding the primary test result.
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
	if dockerRequired(os.Getenv("MOEURL_TEST_REQUIRE_DOCKER")) {
		t.Fatalf("start PostgreSQL test container: %v", err)
	}
	t.Logf("falling back to local PostgreSQL for tests: %v", err)

	databaseURL, cleanup, err = localDatabaseURL(ctx, t.Name(), t)
	if err != nil {
		t.Fatalf("start local PostgreSQL: %v", err)
	}
	t.Cleanup(cleanup)
	return databaseURL
}

// dockerRequired interprets the opt-in flag that forbids the local PostgreSQL fallback.
func dockerRequired(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "1" || normalized == "true"
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

// dockerDatabaseURL creates an isolated database in the process-wide PostgreSQL test container.
func dockerDatabaseURL(ctx context.Context, t testing.TB) (string, func(), error) {
	if err := probeDockerDaemon(); err != nil {
		return "", nil, err
	}
	adminURL, err := sharedDockerDatabaseURL()
	if err != nil {
		return "", nil, err
	}
	return isolatedDatabaseURL(ctx, adminURL, t.Name(), t)
}

// sharedDockerDatabaseURL starts one PostgreSQL container per test process.
func sharedDockerDatabaseURL() (string, error) {
	dockerContainerOnce.Do(func() {
		startupContext, cancelStartup := context.WithTimeout(context.Background(), dockerContainerStartupTimeout)
		defer cancelStartup()
		container, err := postgres.Run(startupContext,
			"postgres:18-alpine",
			postgres.WithDatabase("postgres"),
			postgres.WithUsername("moeurl"),
			postgres.WithPassword("moeurl"),
			testcontainers.WithWaitStrategy(
				wait.ForLog("database system is ready to accept connections").
					WithOccurrence(2).
					WithStartupTimeout(dockerContainerStartupTimeout),
			),
		)
		if err != nil {
			dockerContainerErr = err
			return
		}
		dockerContainerInstance = container
		dockerContainerURL, err = container.ConnectionString(startupContext, "sslmode=disable")
		if err != nil {
			dockerContainerErr = err
			if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil {
				dockerContainerErr = fmt.Errorf("%w: terminate container: %v", err, terminateErr)
			}
			dockerContainerInstance = nil
		}
	})
	return dockerContainerURL, dockerContainerErr
}

// probeDockerDaemon caches an independent bounded Docker availability probe.
func probeDockerDaemon() error {
	dockerProbeOnce.Do(func() {
		probeContext, cancelProbe := newDockerProbeContext()
		defer cancelProbe()
		if err := exec.CommandContext(probeContext, "docker", "info", "--format", "{{.ServerVersion}}").Run(); err != nil {
			dockerProbeErr = fmt.Errorf("probe Docker daemon: %w", err)
		}
	})
	return dockerProbeErr
}

// newDockerProbeContext creates a caller-independent context for the cached daemon probe.
func newDockerProbeContext() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), dockerProbeTimeout)
}

// localDatabaseURL creates an isolated database on the configured local PostgreSQL server.
func localDatabaseURL(ctx context.Context, testName string, t testing.TB) (string, func(), error) {
	adminURL := os.Getenv("MOEURL_TEST_POSTGRES_ADMIN_URL")
	if adminURL == "" {
		adminURL = localAdminDatabaseURL
	}

	return isolatedDatabaseURL(ctx, adminURL, testName, t)
}

// isolatedDatabaseURL provisions and cleans up one database on an existing PostgreSQL server.
func isolatedDatabaseURL(ctx context.Context, adminURL string, testName string, t testing.TB) (string, func(), error) {
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
		reportCleanupError(t, "close test database admin connection", adminDatabase.Close())
		return "", nil, err
	}
	if _, err := adminDatabase.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", databaseName)); err != nil {
		reportCleanupError(t, "close test database admin connection", adminDatabase.Close())
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

// localDatabaseName derives a PostgreSQL-safe unique name from the current test.
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
