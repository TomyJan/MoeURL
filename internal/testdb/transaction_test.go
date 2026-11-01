package testdb

import (
	"context"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type rollbackRecorder struct {
	cleanupReporter
}

func (*rollbackRecorder) Helper() {}

func TestMain(m *testing.M) {
	os.Exit(RunTests(m))
}

// TestRollbackCleanupReportsResult distinguishes harmless closed transactions from failures.
func TestRollbackCleanupReportsResult(t *testing.T) {
	for _, tt := range []struct {
		name string
		err  error
		want string
	}{
		{name: "success"},
		{name: "already closed", err: pgx.ErrTxClosed},
		{name: "wrapped closed", err: fmt.Errorf("already finished: %w", pgx.ErrTxClosed)},
		{name: "network failure", err: errors.New("connection lost"), want: "connection lost"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			reporter := &rollbackRecorder{}
			Rollback(reporter, func(ctx context.Context) error {
				require.NoError(t, ctx.Err())
				return tt.err
			})
			if tt.want == "" {
				assert.Empty(t, reporter.errors)
			} else {
				require.Len(t, reporter.errors, 1)
				assert.Contains(t, reporter.errors[0], "rollback test transaction")
				assert.Contains(t, reporter.errors[0], tt.want)
			}
		})
	}
}

// TestRollbackCleanupRealTransactionAfterCallerCancellation proves real data and lock cleanup.
func TestRollbackCleanupRealTransactionAfterCallerCancellation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool := ProjectMigratedPool(ctx, t)
	_, err := pool.Exec(ctx, "CREATE TABLE rollback_cleanup_probe (id integer PRIMARY KEY)")
	require.NoError(t, err)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer Rollback(t, tx.Rollback)
	_, err = tx.Exec(ctx, "INSERT INTO rollback_cleanup_probe (id) VALUES (1)")
	require.NoError(t, err)
	cancel()

	reporter := &rollbackRecorder{}
	Rollback(reporter, tx.Rollback)
	require.Empty(t, reporter.errors)

	verifyCtx, verifyCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer verifyCancel()
	var count int
	require.NoError(t, pool.QueryRow(verifyCtx, "SELECT count(*) FROM rollback_cleanup_probe").Scan(&count))
	assert.Zero(t, count, "uncommitted data must not survive cleanup")
	_, err = pool.Exec(verifyCtx, "INSERT INTO rollback_cleanup_probe (id) VALUES (1)")
	require.NoError(t, err, "another connection must acquire the released unique-key lock")
}

// TestRollbackCleanupBoundsIO makes an external rollback wait for its real context deadline.
func TestRollbackCleanupBoundsIO(t *testing.T) {
	reporter := &rollbackRecorder{}
	started := time.Now()
	Rollback(reporter, func(ctx context.Context) error {
		deadline, ok := ctx.Deadline()
		if !ok {
			return errors.New("rollback I/O has no deadline")
		}
		remaining := time.Until(deadline)
		require.Positive(t, remaining)
		assert.LessOrEqual(t, remaining, 5*time.Second)
		<-ctx.Done()
		return ctx.Err()
	})
	require.Len(t, reporter.errors, 1)
	assert.Contains(t, reporter.errors[0], context.DeadlineExceeded.Error())
	assert.Less(t, time.Since(started), 15*time.Second)
}

// TestRollbackCleanupCancelsContextAfterReturn prevents retaining a live cleanup timer.
func TestRollbackCleanupCancelsContextAfterReturn(t *testing.T) {
	reporter := &rollbackRecorder{}
	var observed context.Context
	Rollback(reporter, func(ctx context.Context) error {
		observed = ctx
		return nil
	})
	require.NotNil(t, observed)
	assert.ErrorIs(t, observed.Err(), context.Canceled)
	assert.Empty(t, reporter.errors)
}

// TestRollbackCleanupCancelsContextAfterPanic preserves the panic while retiring the timer.
func TestRollbackCleanupCancelsContextAfterPanic(t *testing.T) {
	reporter := &rollbackRecorder{}
	var observed context.Context
	require.PanicsWithValue(t, "rollback panic", func() {
		Rollback(reporter, func(ctx context.Context) error {
			observed = ctx
			panic("rollback panic")
		})
	})
	require.NotNil(t, observed)
	assert.ErrorIs(t, observed.Err(), context.Canceled)
	assert.Empty(t, reporter.errors)
}
