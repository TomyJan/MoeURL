package testdb

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type rollbackReporter interface {
	cleanupErrorReporter
	Helper()
}

// Rollback gives transaction cleanup its own five-second context, even after the test is canceled.
// Passing the transaction's method value preserves each caller's cleanup order.
func Rollback(reporter rollbackReporter, rollback func(context.Context) error) {
	reporter.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := rollback(ctx)
	if !errors.Is(err, pgx.ErrTxClosed) {
		reportCleanupError(reporter, "rollback test transaction", err)
	}
}
