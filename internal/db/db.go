package db

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
)

// OpenPool creates and verifies a PostgreSQL connection pool.
func OpenPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, err
	}

	return pgxpool.NewWithConfig(ctx, config)
}
