package testdb

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/jackc/pgx/v5/pgxpool"
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

	dockerContainerOnce sync.Once
	dockerContainerURL  string
	dockerContainerErr  error
	dockerShutdown      sharedContainerShutdown
	gooseMigrationMu    sync.Mutex
)

// sharedContainerShutdown caches process-level container termination exactly once.
type sharedContainerShutdown struct {
	once      sync.Once
	terminate func() error
	err       error
}

// run invokes the registered termination callback at most once.
func (s *sharedContainerShutdown) run() error {
	s.once.Do(func() {
		if s.terminate != nil {
			s.err = s.terminate()
		}
	})
	return s.err
}

// reportCleanupError reports best-effort cleanup failures without hiding the primary test result.
func reportCleanupError(reporter cleanupErrorReporter, operation string, err error) {
	if err != nil {
		reporter.Errorf("%s: %v", operation, err)
	}
}

// DatabaseURL returns a fresh PostgreSQL URL for tests.
// It prefers Docker when available and falls back to a local PostgreSQL
// instance when Docker cannot start on the current machine.
func DatabaseURL(ctx context.Context, t testing.TB) string {
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
// Goose uses package-level dialect and migration state, so SetDialect and Up
// must remain serialized when tests create migrated databases concurrently.
func MigratedDatabaseURL(ctx context.Context, t testing.TB, migrationsDir string) string {
	t.Helper()

	databaseURL := DatabaseURL(ctx, t)
	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		reportCleanupError(t, "close test database", database.Close())
	})

	gooseMigrationMu.Lock()
	defer gooseMigrationMu.Unlock()
	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.Up(database, migrationsDir); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return databaseURL
}

// ProjectMigratedDatabaseURL returns a migrated database using the repository migrations.
func ProjectMigratedDatabaseURL(ctx context.Context, t testing.TB) string {
	t.Helper()
	_, sourceFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("locate project migrations")
	}
	return MigratedDatabaseURL(ctx, t, filepath.Join(filepath.Dir(sourceFile), "..", "..", "migrations"))
}

// ProjectMigratedPool opens a pool against a fresh project-migrated test database.
func ProjectMigratedPool(ctx context.Context, t testing.TB) *pgxpool.Pool {
	t.Helper()
	databaseURL := ProjectMigratedDatabaseURL(ctx, t)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// RunTests runs a package test suite and terminates its shared PostgreSQL container before exit.
func RunTests(m *testing.M) int {
	code := m.Run()
	if err := ShutdownSharedDockerContainer(); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "terminate shared PostgreSQL test container: %v\n", err)
		if code == 0 {
			return 1
		}
	}
	return code
}

// ShutdownSharedDockerContainer terminates the process-wide test container at most once.
func ShutdownSharedDockerContainer() error {
	return dockerShutdown.run()
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
	databaseURL, cleanup, err := isolatedDatabaseURL(ctx, adminURL, t.Name(), t)
	if err != nil {
		return "", nil, err
	}
	return databaseURL, cleanup, nil
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
			if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil {
				dockerContainerErr = errors.Join(err, fmt.Errorf("terminate container: %w", terminateErr))
			}
			return
		}
		dockerContainerURL, err = container.ConnectionString(startupContext, "sslmode=disable")
		if err != nil {
			dockerContainerErr = err
			if terminateErr := testcontainers.TerminateContainer(container); terminateErr != nil {
				dockerContainerErr = fmt.Errorf("%w: terminate container: %v", err, terminateErr)
			}
			return
		}
		dockerShutdown.terminate = func() error {
			return testcontainers.TerminateContainer(container)
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
	// databaseName comes from localDatabaseName's fixed prefix and [a-z0-9_] sanitizer;
	// PostgreSQL identifiers cannot be parameterized, so keep this interpolation tied to that allowlist.
	// ast-grep-ignore
	if _, err := adminDatabase.ExecContext(ctx, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", databaseName)); err != nil { // nosemgrep
		reportCleanupError(t, "close test database admin connection", adminDatabase.Close())
		return "", nil, err
	}
	// ast-grep-ignore
	if _, err := adminDatabase.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %s", databaseName)); err != nil { // nosemgrep
		reportCleanupError(t, "close test database admin connection", adminDatabase.Close())
		return "", nil, err
	}
	reportCleanupError(t, "close test database admin connection", adminDatabase.Close())

	cleanup := func() {
		cleanupContext, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		cleanupDatabase, openErr := sql.Open("pgx", adminURL)
		if openErr != nil {
			reportCleanupError(t, "open test database admin connection", openErr)
			return
		}
		// Keep this identifier interpolation safe by changing localDatabaseName's allowlist together with this comment.
		// ast-grep-ignore
		_, dropErr := cleanupDatabase.ExecContext(cleanupContext, fmt.Sprintf("DROP DATABASE IF EXISTS %s WITH (FORCE)", databaseName)) // nosemgrep
		reportCleanupError(t, fmt.Sprintf("drop test database %s", databaseName), dropErr)
		reportCleanupError(t, "close test database admin connection", cleanupDatabase.Close())
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
