package db

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
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

// databaseOperationError redacts driver details while preserving safe diagnostics and the underlying error chain.
type databaseOperationError struct {
	operation string
	category  string
	sqlState  string
	cause     error
}

// newDatabaseOperationError captures only stable diagnostics that are safe to serialize.
func newDatabaseOperationError(operation string, cause error) *databaseOperationError {
	category := "database"
	if errors.Is(cause, context.DeadlineExceeded) || errors.Is(cause, context.Canceled) {
		category = "timeout"
	}
	var postgresError *pgconn.PgError
	if errors.As(cause, &postgresError) {
		category = "postgresql"
		return &databaseOperationError{operation: operation, category: category, sqlState: postgresError.SQLState(), cause: cause}
	}
	return &databaseOperationError{operation: operation, category: category, cause: cause}
}

// Error returns a stable startup-stage message without exposing connection details.
func (err *databaseOperationError) Error() string {
	return err.operation + ": failed"
}

// LogValue exposes only the operation and safe error classification to structured loggers.
func (err *databaseOperationError) LogValue() slog.Value {
	attributes := []slog.Attr{
		slog.String("operation", err.operation),
		slog.String("category", err.category),
	}
	if err.sqlState != "" {
		attributes = append(attributes, slog.String("sqlstate", err.sqlState))
	}
	return slog.GroupValue(attributes...)
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
		return nil, newDatabaseOperationError("parse database configuration", err)
	}

	startupContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	configured, err := createConfiguredPool(startupContext, config)
	if err != nil {
		return nil, newDatabaseOperationError("create database pool", err)
	}
	if err := configured.ping(startupContext); err != nil {
		configured.close()
		return nil, newDatabaseOperationError("verify database connection", err)
	}
	return configured.pool, nil
}
