package auth

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"regexp"
	"strings"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
)

// TestSessionServiceCreatesReadsAndRevokesSession verifies session service creates reads and revokes session.
func TestSessionServiceCreatesReadsAndRevokesSession(t *testing.T) {
	ctx := context.Background()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	userID := "00000000-0000-0000-0000-000000000201"
	insertAuthUser(t, ctx, pool, userID)

	service := NewSessionService(pool, 24*time.Hour)

	session, err := service.Create(ctx, userID)
	if err != nil {
		t.Fatalf("create session: %v", err)
	}
	if session.ID == "" {
		t.Fatal("expected session id")
	}
	if regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`).MatchString(session.ID) {
		t.Fatalf("expected opaque session token, got uuid-shaped id %q", session.ID)
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(session.ID) {
		t.Fatalf("expected URL-safe 256-bit session token, got %q", session.ID)
	}
	if !session.ExpiresAt.After(time.Now()) {
		t.Fatal("expected future expiration")
	}

	resolved, err := service.Resolve(ctx, session.ID)
	if err != nil {
		t.Fatalf("resolve session: %v", err)
	}
	if resolved.UserID != userID {
		t.Fatalf("expected user id %s, got %s", userID, resolved.UserID)
	}

	if err := service.Revoke(ctx, session.ID); err != nil {
		t.Fatalf("revoke session: %v", err)
	}

	_, err = service.Resolve(ctx, session.ID)
	if err == nil {
		t.Fatal("expected revoked session to be rejected")
	}
}

// TestSessionServiceRejectsMissingSession verifies session service rejects missing session.
func TestSessionServiceRejectsMissingSession(t *testing.T) {
	ctx := context.Background()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	service := NewSessionService(pool, 24*time.Hour)

	_, err = service.Resolve(ctx, "missing")
	if !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("expected ErrInvalidSession, got %v", err)
	}
}

// TestSessionServiceReturnsDatabaseErrors verifies session service returns database errors.
func TestSessionServiceReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)

	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	pool.Close()

	service := NewSessionService(pool, 24*time.Hour)

	_, err = service.Create(ctx, "00000000-0000-0000-0000-000000000201")
	if err == nil {
		t.Fatal("expected create database error")
	}

	_, err = service.Resolve(ctx, "missing")
	if err == nil {
		t.Fatal("expected resolve database error")
	}
}

// TestSessionCleanupUsesOneFixedBatch verifies one maintenance cycle never drains unbounded work.
func TestSessionCleanupUsesOneFixedBatch(t *testing.T) {
	ctx := t.Context()
	calls := 0
	service := &SessionService{
		cleanupSessions: func(context.Context) (int64, error) {
			calls++
			return 500, nil
		},
	}

	if err := service.CleanupSessions(ctx); err != nil {
		t.Fatalf("cleanup sessions: %v", err)
	}
	if calls != 1 {
		t.Fatalf("cleanup calls = %d, want 1", calls)
	}
}

// TestSessionCleanupRejectsUnavailableDatabase verifies missing production cleanup dependencies fail safely.
func TestSessionCleanupRejectsUnavailableDatabase(t *testing.T) {
	if err := NewSessionService(nil, time.Hour).CleanupSessions(t.Context()); err == nil || !strings.Contains(err.Error(), "database is unavailable") {
		t.Fatalf("cleanup error = %v, want unavailable database", err)
	}
}

// TestSessionCleanupRunsImmediately verifies startup cleanup does not wait for the first interval.
func TestSessionCleanupRunsImmediately(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupCalled := make(chan struct{}, 1)
	service := &SessionService{
		cleanupSessions: func(cleanupContext context.Context) (int64, error) {
			select {
			case cleanupCalled <- struct{}{}:
				return 0, nil
			case <-cleanupContext.Done():
				return 0, cleanupContext.Err()
			}
		},
	}
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunCleanup(runnerContext, time.Hour, nil)
	}()

	waitForSessionCleanupSignal(t, ctx, cleanupCalled, "immediate cleanup")
	cancelRunner()
	waitForSessionCleanupSignal(t, ctx, runnerDone, "immediate cleanup cancellation")
}

// TestSessionCleanupRunsPeriodically verifies later intervals continue after startup work.
func TestSessionCleanupRunsPeriodically(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupCalls := make(chan int, 2)
	calls := 0
	service := &SessionService{
		cleanupSessions: func(cleanupContext context.Context) (int64, error) {
			calls++
			select {
			case cleanupCalls <- calls:
				return 0, nil
			case <-cleanupContext.Done():
				return 0, cleanupContext.Err()
			}
		},
	}
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunCleanup(runnerContext, time.Millisecond, slog.Default())
	}()

	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "startup cleanup"); call != 1 {
		t.Fatalf("startup cleanup call = %d, want 1", call)
	}
	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "periodic cleanup"); call != 2 {
		t.Fatalf("periodic cleanup call = %d, want 2", call)
	}
	cancelRunner()
	waitForSessionCleanupSignal(t, ctx, runnerDone, "periodic cleanup cancellation")
}

// TestSessionCleanupLogsFailureAndContinues verifies one failed cycle cannot stop later maintenance.
func TestSessionCleanupLogsFailureAndContinues(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupFailure := errors.New("forced cleanup failure")
	cleanupCalls := make(chan int, 2)
	calls := 0
	service := &SessionService{
		cleanupSessions: func(cleanupContext context.Context) (int64, error) {
			calls++
			select {
			case cleanupCalls <- calls:
			case <-cleanupContext.Done():
				return 0, cleanupContext.Err()
			}
			if calls == 1 {
				return 0, cleanupFailure
			}
			return 1, nil
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunCleanup(runnerContext, time.Millisecond, logger)
	}()

	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "failed cleanup cycle"); call != 1 {
		t.Fatalf("failed cleanup call = %d, want 1", call)
	}
	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "recovered cleanup cycle"); call != 2 {
		t.Fatalf("recovered cleanup call = %d, want 2", call)
	}
	cancelRunner()
	waitForSessionCleanupSignal(t, ctx, runnerDone, "cleanup runner after recovery")

	logText := logOutput.String()
	for _, field := range []string{"session_cleanup_failed", "task=session_cleanup", cleanupFailure.Error()} {
		if !strings.Contains(logText, field) {
			t.Fatalf("cleanup failure log = %q, want field %q", logText, field)
		}
	}
	if strings.Contains(logText, "secret-session-id") {
		t.Fatalf("cleanup failure log leaked a session identifier: %q", logText)
	}
}

// TestSessionCleanupCancellationIsQuiet verifies in-flight shutdown exits without an error log.
func TestSessionCleanupCancellationIsQuiet(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupStarted := make(chan struct{})
	service := &SessionService{
		cleanupSessions: func(cleanupContext context.Context) (int64, error) {
			close(cleanupStarted)
			<-cleanupContext.Done()
			return 0, cleanupContext.Err()
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunCleanup(runnerContext, time.Hour, logger)
	}()

	waitForSessionCleanupSignal(t, ctx, cleanupStarted, "in-flight cleanup")
	cancelRunner()
	waitForSessionCleanupSignal(t, ctx, runnerDone, "canceled cleanup runner")
	if strings.Contains(logOutput.String(), "session_cleanup_failed") {
		t.Fatalf("task cancellation logged as cleanup failure: %q", logOutput.String())
	}
}

// TestSessionCleanupPeriodicCancellationIsQuiet verifies shutdown also interrupts a ticker-triggered database operation.
func TestSessionCleanupPeriodicCancellationIsQuiet(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupCalls := make(chan int, 2)
	calls := 0
	service := &SessionService{
		cleanupSessions: func(cleanupContext context.Context) (int64, error) {
			calls++
			cleanupCalls <- calls
			if calls == 1 {
				return 0, nil
			}
			<-cleanupContext.Done()
			return 0, cleanupContext.Err()
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunCleanup(runnerContext, time.Millisecond, logger)
	}()

	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "startup cleanup before cancellation"); call != 1 {
		t.Fatalf("startup cleanup call = %d, want 1", call)
	}
	if call := waitForSessionCleanupValue(t, ctx, cleanupCalls, "periodic cleanup before cancellation"); call != 2 {
		t.Fatalf("periodic cleanup call = %d, want 2", call)
	}
	cancelRunner()
	waitForSessionCleanupSignal(t, ctx, runnerDone, "periodically canceled cleanup runner")
	if strings.Contains(logOutput.String(), "session_cleanup_failed") {
		t.Fatalf("periodic task cancellation logged as cleanup failure: %q", logOutput.String())
	}
}

// TestSessionCleanupSkipsInvalidOrCanceledRuns verifies shutdown and invalid intervals cannot start database work.
func TestSessionCleanupSkipsInvalidOrCanceledRuns(t *testing.T) {
	calls := 0
	service := &SessionService{
		cleanupSessions: func(context.Context) (int64, error) {
			calls++
			return 0, nil
		},
	}
	service.RunCleanup(t.Context(), 0, nil)

	runnerContext, cancelRunner := context.WithCancel(t.Context())
	cancelRunner()
	logOutput := &bytes.Buffer{}
	service.RunCleanup(runnerContext, time.Hour, slog.New(slog.NewTextHandler(logOutput, nil)))

	if calls != 0 {
		t.Fatalf("skipped cleanup calls = %d, want 0", calls)
	}
	if logOutput.Len() != 0 {
		t.Fatalf("pre-canceled cleanup log = %q, want empty", logOutput.String())
	}
}

// waitForSessionCleanupSignal waits for a required maintenance event with a caller-owned timeout.
func waitForSessionCleanupSignal(t *testing.T, ctx context.Context, signal <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-signal:
	case <-ctx.Done():
		t.Fatalf("timed out waiting for %s: %v", operation, ctx.Err())
	}
}

// waitForSessionCleanupValue waits for a required maintenance result with a caller-owned timeout.
func waitForSessionCleanupValue[T any](t *testing.T, ctx context.Context, values <-chan T, operation string) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-ctx.Done():
		t.Fatalf("timed out waiting for %s: %v", operation, ctx.Err())
		var zero T
		return zero
	}
}

// insertAuthUser inserts the database fixture required by the surrounding tests.
func insertAuthUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, userID string) {
	t.Helper()

	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now());
	`)
	if err != nil {
		t.Fatalf("insert auth group: %v", err)
	}

	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now());
	`, userID)
	if err != nil {
		t.Fatalf("insert auth user: %v", err)
	}
}
