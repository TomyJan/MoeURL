package targetpolicy_test

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// policyReadCounter forwards every query to the real PostgreSQL transaction;
// counting does not replace saved-rule validation or its observable decisions.
type policyReadCounter struct {
	pgx.Tx
	reads map[string]int
}

func (q *policyReadCounter) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	if len(args) == 1 {
		if key, ok := args[0].(string); ok {
			q.reads[key]++
		}
	}
	return q.Tx.QueryRow(ctx, query, args...)
}

// Re-reading per target would use 140 queries rather than seven for this batch;
// grouping targets into one aggregate decision would lose their mixed outcomes.
func TestCheckTargetsIndividuallyReadsOnce(t *testing.T) {
	pool, _, _ := fixture(t)
	_, err := pool.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	tx, err := pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted, AccessMode: pgx.ReadOnly})
	require.NoError(t, err)
	defer testdb.Rollback(t, tx.Rollback)
	require.NoError(t, targetpolicy.LockTargets(t.Context(), tx))
	counter := &policyReadCounter{Tx: tx, reads: map[string]int{}}
	targets := make([]string, 20)
	for i := range targets {
		targets[i] = "https://allowed.example/"
	}
	targets[1] = "https://blocked.example/"
	targets[2] = "not a URL"
	results, err := targetpolicy.CheckTargetsIndividually(t.Context(), sqlc.New(counter), targets)
	require.NoError(t, err)
	require.Len(t, results, 20)
	for i, result := range results {
		switch i {
		case 1:
			require.ErrorIs(t, result, targetpolicy.ErrTargetDenied)
		case 2:
			require.ErrorIs(t, result, targetpolicy.ErrInvalidTarget)
		default:
			require.NoError(t, result)
		}
	}
	require.Equal(t, map[string]int{targetpolicy.Key: 1, targetpolicy.AllowlistKey: 1, targetpolicy.SuffixKey: 1, targetpolicy.SuffixAllowlistKey: 1, targetpolicy.IPKey: 1, targetpolicy.CIDRKey: 1, targetpolicy.CIDRAllowlistKey: 1}, counter.reads)
	// The existing all-target write check retains its aggregate rejection contract.
	require.ErrorIs(t, targetpolicy.CheckTargets(t.Context(), sqlc.New(tx), []string{"https://allowed.example/", "https://blocked.example/"}), targetpolicy.ErrTargetDenied)
}

// A missing or corrupt resource must fail before per-target decisions, even
// when the first target is a known deny and would otherwise hide later storage.
func TestCheckTargetsIndividuallyStorageFailures(t *testing.T) {
	pool, _, _ := fixture(t)
	for _, key := range []string{targetpolicy.Key, targetpolicy.AllowlistKey, targetpolicy.SuffixKey, targetpolicy.SuffixAllowlistKey, targetpolicy.IPKey, targetpolicy.CIDRKey, targetpolicy.CIDRAllowlistKey} {
		for _, missing := range []bool{false, true} {
			name := "corrupt " + key
			if missing {
				name = "missing " + key
			}
			t.Run(name, func(t *testing.T) {
				tx, err := pool.Begin(t.Context())
				require.NoError(t, err)
				defer testdb.Rollback(t, tx.Rollback)
				require.NoError(t, targetpolicy.LockPolicyUpdate(t.Context(), tx))
				_, err = tx.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
				require.NoError(t, err)
				if missing {
					_, err = tx.Exec(t.Context(), `delete from system_setting where key=$1`, key)
				} else {
					_, err = tx.Exec(t.Context(), `update system_setting set value='{}' where key=$1`, key)
				}
				require.NoError(t, err)
				results, err := targetpolicy.CheckTargetsIndividually(t.Context(), sqlc.New(tx), []string{"https://blocked.example/", "https://allowed.example/"})
				require.Error(t, err)
				if !missing {
					require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
				}
				require.Nil(t, results)
			})
		}
	}
}
