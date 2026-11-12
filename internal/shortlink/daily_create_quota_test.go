package shortlink_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/createquota"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestDailyCreateQuotaCreationGate catches either writer bypassing the quota
// gate, consuming after cancellation or accepting a definite zero-budget write.
func TestDailyCreateQuotaCreationGate(t *testing.T) {
	for _, batch := range []bool{false, true} {
		for _, canceled := range []bool{false, true} {
			t.Run(fmt.Sprintf("batch=%t/canceled=%t", batch, canceled), func(t *testing.T) {
				pool, service, actor := targetWriteFixture(t)
				write := func(ctx context.Context) error {
					if batch {
						_, err := service.BatchCreate(ctx, actor, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://quota.example/new"}})
						return err
					}
					_, err := service.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://quota.example/new"})
					return err
				}
				if canceled {
					tx, err := pool.Begin(t.Context())
					require.NoError(t, err)
					defer testdb.Rollback(t, tx.Rollback)
					_, err = tx.Exec(t.Context(), `select pg_advisory_xact_lock(1297040725,1129403727)`)
					require.NoError(t, err)
					ctx, cancel := context.WithCancel(t.Context())
					defer cancel()
					out := make(chan error, 1)
					go func() { out <- write(ctx) }()
					require.Eventually(t, func() bool {
						var waiting bool
						err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid)))`, tx.Conn().PgConn().PID()).Scan(&waiting)
						return err == nil && waiting
					}, 3*time.Second, 5*time.Millisecond)
					cancel()
					require.ErrorIs(t, <-out, context.Canceled)
					require.NoError(t, tx.Rollback(t.Context()))
				} else {
					_, err := pool.Exec(t.Context(), `update system_setting set value='{"dailyLimit":0}' where key='security.account_daily_create_quota'`)
					require.NoError(t, err)
					require.ErrorIs(t, write(t.Context()), createquota.ErrExhausted)
				}
				var links, audits, receipts, usage int
				require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch),(select count(*) from account_daily_create_usage)`).Scan(&links, &audits, &receipts, &usage))
				require.Equal(t, []int{0, 0, 0, 0}, []int{links, audits, receipts, usage})
			})
		}
	}
}
