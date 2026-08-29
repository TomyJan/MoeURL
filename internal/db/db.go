package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const databaseStartupTimeout = 10 * time.Second

// configuredPool retains lifecycle hooks needed to close partially initialized pools.
type configuredPool struct {
	pool  *pgxpool.Pool
	ping  func(context.Context) error
	close func()
}

// createConfiguredPool opens a pool while allowing deterministic startup-failure tests.
var createConfiguredPool = func(ctx context.Context, config *pgxpool.Config) (*configuredPool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return &configuredPool{pool: pool, ping: pool.Ping, close: pool.Close}, nil
}

// databaseOperationError redacts driver details while preserving the underlying error chain.
type databaseOperationError struct {
	operation string
	cause     error
}

// Error returns a stable startup-stage message without exposing connection details.
func (err *databaseOperationError) Error() string {
	return err.operation + ": failed"
}

// Unwrap exposes the underlying cause for errors.Is and errors.As inspection.
func (err *databaseOperationError) Unwrap() error {
	return err.cause
}

// OpenPool creates and verifies a PostgreSQL connection pool.
func OpenPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	return openPoolWithTimeout(ctx, databaseURL, databaseStartupTimeout)
}

// openPoolWithTimeout parses, creates, and verifies a pool within a bounded startup window.
func openPoolWithTimeout(ctx context.Context, databaseURL string, timeout time.Duration) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, &databaseOperationError{operation: "parse database configuration", cause: err}
	}

	startupContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	configured, err := createConfiguredPool(startupContext, config)
	if err != nil {
		return nil, &databaseOperationError{operation: "create database pool", cause: err}
	}
	if err := configured.ping(startupContext); err != nil {
		configured.close()
		return nil, &databaseOperationError{operation: "verify database connection", cause: err}
	}
	return configured.pool, nil
}
