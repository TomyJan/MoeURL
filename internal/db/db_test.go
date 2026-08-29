package db

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const testDatabaseURL = "postgres://user:password@database.internal:5432/moeurl?sslmode=disable"

func TestOpenPoolRejectsInvalidConfigurationWithoutLeakingInput(t *testing.T) {
	const invalidURL = "postgres://user:top-secret@database.internal:invalid/moeurl"

	pool, err := OpenPool(t.Context(), invalidURL)

	if pool != nil {
		t.Fatal("OpenPool returned a pool for invalid configuration")
	}
	if err == nil || !strings.Contains(err.Error(), "parse database configuration") {
		t.Fatalf("OpenPool error = %v, want parse context", err)
	}
	if strings.Contains(err.Error(), invalidURL) || strings.Contains(err.Error(), "top-secret") {
		t.Fatalf("OpenPool error leaked database URL: %v", err)
	}
}

func TestOpenPoolPingsBeforeReturning(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	fakePool := &pgxpool.Pool{}
	pingCalled := false
	closeCalled := false
	createConfiguredPool = func(_ context.Context, config *pgxpool.Config) (*configuredPool, error) {
		if config.ConnConfig.Host != "database.internal" || config.ConnConfig.Database != "moeurl" {
			t.Fatalf("unexpected parsed configuration: host %q database %q", config.ConnConfig.Host, config.ConnConfig.Database)
		}
		return &configuredPool{
			pool: fakePool,
			ping: func(context.Context) error {
				pingCalled = true
				return nil
			},
			close: func() { closeCalled = true },
		}, nil
	}

	pool, err := OpenPool(t.Context(), testDatabaseURL)

	if err != nil {
		t.Fatalf("OpenPool returned error: %v", err)
	}
	if pool != fakePool {
		t.Fatalf("OpenPool returned pool %p, want %p", pool, fakePool)
	}
	if !pingCalled {
		t.Fatal("OpenPool returned before Ping")
	}
	if closeCalled {
		t.Fatal("OpenPool closed a healthy pool")
	}
}

func TestOpenPoolWrapsCreateFailureWithoutLeakingDiagnostics(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	const sensitiveDiagnostic = "create pool for postgres://user:top-secret@database.internal/moeurl: failed"
	wantErr := errors.New(sensitiveDiagnostic)
	createConfiguredPool = func(context.Context, *pgxpool.Config) (*configuredPool, error) {
		return nil, wantErr
	}

	pool, err := OpenPool(t.Context(), testDatabaseURL)

	if pool != nil {
		t.Fatal("OpenPool returned a pool after pool creation failed")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("OpenPool error = %v, want wrapped pool creation failure", err)
	}
	if !strings.Contains(err.Error(), "create database pool") {
		t.Fatalf("OpenPool error = %v, want operation context", err)
	}
	if strings.Contains(err.Error(), sensitiveDiagnostic) || strings.Contains(err.Error(), "top-secret") || strings.Contains(err.Error(), testDatabaseURL) {
		t.Fatalf("OpenPool error leaked sensitive diagnostics: %v", err)
	}
}

func TestOpenPoolClosesPoolWhenPingFails(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	const sensitiveDiagnostic = "dial postgres://user:top-secret@database.internal/moeurl: refused"
	wantErr := errors.New(sensitiveDiagnostic)
	closeCalls := 0
	createConfiguredPool = func(context.Context, *pgxpool.Config) (*configuredPool, error) {
		return &configuredPool{
			pool: &pgxpool.Pool{},
			ping: func(context.Context) error {
				return wantErr
			},
			close: func() { closeCalls++ },
		}, nil
	}

	pool, err := OpenPool(t.Context(), testDatabaseURL)

	if pool != nil {
		t.Fatal("OpenPool returned a pool after Ping failed")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("OpenPool error = %v, want wrapped Ping failure", err)
	}
	if !strings.Contains(err.Error(), "verify database connection") {
		t.Fatalf("OpenPool error = %v, want operation context", err)
	}
	if strings.Contains(err.Error(), sensitiveDiagnostic) || strings.Contains(err.Error(), "top-secret") {
		t.Fatalf("OpenPool error leaked database URL: %v", err)
	}
	if closeCalls != 1 {
		t.Fatalf("pool close calls = %d, want 1", closeCalls)
	}
}

func TestOpenPoolWithTimeoutBoundsCreateAndPing(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	const timeout = 250 * time.Millisecond
	var createDeadline time.Time
	var createObservedAt time.Time
	var pingDeadline time.Time
	createConfiguredPool = func(ctx context.Context, _ *pgxpool.Config) (*configuredPool, error) {
		createObservedAt = time.Now()
		var ok bool
		createDeadline, ok = ctx.Deadline()
		if !ok {
			t.Fatal("pool creation context has no deadline")
		}
		return &configuredPool{
			pool: &pgxpool.Pool{},
			ping: func(ctx context.Context) error {
				pingDeadline, ok = ctx.Deadline()
				if !ok {
					t.Fatal("Ping context has no deadline")
				}
				return nil
			},
			close: func() {},
		}, nil
	}
	pool, err := openPoolWithTimeout(t.Context(), testDatabaseURL, timeout)

	if err != nil || pool == nil {
		t.Fatalf("openPoolWithTimeout = pool %p error %v", pool, err)
	}
	if !createDeadline.Equal(pingDeadline) {
		t.Fatalf("create deadline %s and Ping deadline %s differ", createDeadline, pingDeadline)
	}
	remaining := createDeadline.Sub(createObservedAt)
	if remaining <= 0 || remaining > timeout {
		t.Fatalf("startup deadline after %s, want (0, %s]", remaining, timeout)
	}
}

func TestOpenPoolWithTimeoutPreservesDeadlineFailureAndClosesPoolOnce(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	closeCalls := 0
	createConfiguredPool = func(context.Context, *pgxpool.Config) (*configuredPool, error) {
		return &configuredPool{
			pool: &pgxpool.Pool{},
			ping: func(ctx context.Context) error {
				<-ctx.Done()
				return ctx.Err()
			},
			close: func() { closeCalls++ },
		}, nil
	}

	pool, err := openPoolWithTimeout(t.Context(), testDatabaseURL, time.Millisecond)

	if pool != nil {
		t.Fatal("openPoolWithTimeout returned a pool after Ping timed out")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("openPoolWithTimeout error = %v, want deadline exceeded", err)
	}
	if !strings.Contains(err.Error(), "verify database connection") {
		t.Fatalf("openPoolWithTimeout error = %v, want Ping operation context", err)
	}
	if closeCalls != 1 {
		t.Fatalf("pool close calls = %d, want 1", closeCalls)
	}
}

func TestOpenPoolWithTimeoutUsesEarlierParentDeadline(t *testing.T) {
	originalCreate := createConfiguredPool
	t.Cleanup(func() { createConfiguredPool = originalCreate })
	parent, cancel := context.WithTimeout(t.Context(), 250*time.Millisecond)
	t.Cleanup(cancel)
	parentDeadline, ok := parent.Deadline()
	if !ok {
		t.Fatal("parent context has no deadline")
	}
	var createDeadline time.Time
	createConfiguredPool = func(ctx context.Context, _ *pgxpool.Config) (*configuredPool, error) {
		createDeadline, ok = ctx.Deadline()
		if !ok {
			t.Fatal("pool creation context has no deadline")
		}
		return &configuredPool{pool: &pgxpool.Pool{}, ping: func(context.Context) error { return nil }, close: func() {}}, nil
	}

	pool, err := openPoolWithTimeout(parent, testDatabaseURL, time.Hour)

	if err != nil || pool == nil {
		t.Fatalf("openPoolWithTimeout = pool %p error %v", pool, err)
	}
	if !createDeadline.Equal(parentDeadline) {
		t.Fatalf("startup deadline = %s, want earlier parent deadline %s", createDeadline, parentDeadline)
	}
}
