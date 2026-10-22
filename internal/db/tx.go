package db

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// WithTx runs fn in a transaction and commits it when fn returns successfully.
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()
	if actorID, marked := ctx.Value(auditActorKey{}).(string); marked {
		if err := SetAuditContext(ctx, tx, actorID); err != nil {
			return err
		}
	}

	if err := fn(tx); err != nil {
		return err
	}

	return tx.Commit(ctx)
}
