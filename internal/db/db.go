package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

type configuredPool struct {
	pool  *pgxpool.Pool
	ping  func(context.Context) error
	close func()
}

var createConfiguredPool = func(ctx context.Context, config *pgxpool.Config) (*configuredPool, error) {
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, err
	}
	return &configuredPool{pool: pool, ping: pool.Ping, close: pool.Close}, nil
}

type databaseOperationError struct {
	operation string
	cause     error
}

func (err *databaseOperationError) Error() string {
	return err.operation + ": failed"
}

func (err *databaseOperationError) Unwrap() error {
	return err.cause
}

// OpenPool creates and verifies a PostgreSQL connection pool.
func OpenPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, &databaseOperationError{operation: "parse database configuration", cause: err}
	}

	configured, err := createConfiguredPool(ctx, config)
	if err != nil {
		return nil, &databaseOperationError{operation: "create database pool", cause: err}
	}
	if err := configured.ping(ctx); err != nil {
		configured.close()
		return nil, &databaseOperationError{operation: "verify database connection", cause: err}
	}
	return configured.pool, nil
}
