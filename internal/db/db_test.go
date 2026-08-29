package db

import (
	"context"
	"errors"
	"strings"
	"testing"

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
