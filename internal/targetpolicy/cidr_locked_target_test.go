package targetpolicy_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/stretchr/testify/require"
)

// Comparing an unlocked target snapshot would either reject an unchanged
// historical target or bypass CIDR validation after a concurrent target change.
func TestCIDRPolicyComparesLockedTarget(t *testing.T) {
	for _, admin := range []bool{false, true} {
		for _, identical := range []bool{false, true} {
			name := "own/changed"
			if admin {
				name = "admin/changed"
			}
			if identical {
				name += "/identical-after-lock"
			}
			t.Run(name, func(t *testing.T) {
				pool, _, actor := fixture(t)
				links := shortlink.NewService(pool, permission.NewDatabaseService(pool))
				requested := "https://203.0.113.9/historical"
				initial, concurrent := requested, "https://safe.example/concurrent"
				if identical {
					initial, concurrent = "https://safe.example/original", requested
				}
				created, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: initial})
				require.NoError(t, err)
				_, err = pool.Exec(t.Context(), `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`)
				require.NoError(t, err)
				tx, err := pool.Begin(t.Context())
				require.NoError(t, err)
				defer testdb.Rollback(t, tx.Rollback)
				_, err = tx.Exec(t.Context(), `update short_link set target_url=$1 where id=$2`, concurrent, created.ShortLink.ID)
				require.NoError(t, err)
				out := make(chan error, 1)
				go func() {
					update := links.Update
					if admin {
						update = links.AdminUpdate
					}
					_, err := update(t.Context(), actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &requested})
					out <- err
				}()
				waitBlocked(t, pool, tx.Conn().PgConn().PID())
				require.NoError(t, tx.Commit(t.Context()))
				err = <-out
				if identical {
					require.NoError(t, err)
				} else {
					require.ErrorIs(t, err, targetpolicy.ErrTargetDenied)
				}
				var stored string
				require.NoError(t, pool.QueryRow(t.Context(), `select target_url from short_link where id=$1`, created.ShortLink.ID).Scan(&stored))
				require.Equal(t, concurrent, stored)
			})
		}
	}
}
