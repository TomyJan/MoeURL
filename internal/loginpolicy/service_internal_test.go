package loginpolicy

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
)

type commitFailingTx struct {
	pgx.Tx
	err error
}

// Commit returns the configured failure while preserving the real transaction for rollback cleanup.
func (tx commitFailingTx) Commit(context.Context) error {
	return tx.err
}

// TestValidateStartupPropagatesTransactionLifecycleFailures verifies startup fails closed at transaction boundaries.
func TestValidateStartupPropagatesTransactionLifecycleFailures(t *testing.T) {
	t.Run("begin", func(t *testing.T) {
		beginErr := errors.New("begin startup snapshot")
		service := NewService(nil, nil)
		service.beginTx = func(context.Context, pgx.TxOptions) (pgx.Tx, error) {
			return nil, beginErr
		}

		if err := service.ValidateStartup(t.Context()); !errors.Is(err, beginErr) {
			t.Fatalf("startup error = %v, want begin failure", err)
		}
	})

	t.Run("commit", func(t *testing.T) {
		pool := testdb.ProjectMigratedPool(t.Context(), t)
		commitErr := errors.New("commit startup snapshot")
		service := NewService(pool, func([]sqlc.OidcProvider) error { return nil })
		service.beginTx = func(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error) {
			tx, err := pool.BeginTx(ctx, options)
			if err != nil {
				return nil, err
			}
			return commitFailingTx{Tx: tx, err: commitErr}, nil
		}

		if err := service.ValidateStartup(t.Context()); !errors.Is(err, commitErr) {
			t.Fatalf("startup error = %v, want commit failure", err)
		}
	})
}
