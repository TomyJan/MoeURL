package http_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestBulkExpirationDomainLockDeadline catches a clock read before granted-domain row locks.
func TestBulkExpirationDomainLockDeadline(t *testing.T) {
	expirationAfterRemainingLock(t, false)
}

// TestBulkExpirationQuotaLockDeadline catches a clock read before the usage row lock.
func TestBulkExpirationQuotaLockDeadline(t *testing.T) {
	expirationAfterRemainingLock(t, true)
}

// expirationAfterRemainingLock observes the exact blocked query and the real database deadline.
func expirationAfterRemainingLock(t *testing.T, quota bool) {
	t.Helper()
	f := newExpirationRouterFixture(t)
	if quota {
		_, err := f.pool.Exec(t.Context(), `insert into account_daily_create_usage(actor_id,usage_day,used) values($1::uuid,date '0001-01-01',0)`, metadataRouterActor)
		require.NoError(t, err)
	}
	tx, err := f.pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	lockSQL := `select id from domain for update`
	waitQuery := `-- name: GetGrantedShortLinkDomainForCreate%`
	if quota {
		lockSQL = `select actor_id from account_daily_create_usage where actor_id=$1::uuid for update`
		_, err = tx.Exec(t.Context(), lockSQL, metadataRouterActor)
		waitQuery = `-- name: LockAccountDailyCreateUsage%`
	} else {
		_, err = tx.Exec(t.Context(), lockSQL)
	}
	require.NoError(t, err)
	expiry := expirationDeadline(t, f)
	var input shortlink.BatchCreateWithExpirationsInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), strings.Replace(expirationRow, "2099-01-01T00:00:00Z", expiry.Format(time.RFC3339), 1))), &input))
	before := redirectModeSnapshot(t, f)
	done := make(chan error, 1)
	go func() {
		_, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithExpirations(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := f.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like $1)`, waitQuery).Scan(&waiting)
		return err == nil && waiting
	}, time.Second, 5*time.Millisecond)
	waitExpirationDeadline(t, f, expiry)
	require.NoError(t, tx.Commit(t.Context()))
	select {
	case err := <-done:
		assert.ErrorIs(t, err, shortlink.ErrInvalidExpiration)
	case <-time.After(6 * time.Second):
		t.Fatal("write waiting on the remaining lock did not settle")
	}
	require.Equal(t, before, redirectModeSnapshot(t, f))
}
