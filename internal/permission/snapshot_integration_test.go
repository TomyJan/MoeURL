package permission_test

import (
	"os"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// TestMain releases the package's shared PostgreSQL container after all assertions and cleanup.
func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }

// TestInsightPermissionSnapshotStaysInCallerTransaction catches accidental pool-based permission reads.
func TestInsightPermissionSnapshotStaysInCallerTransaction(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'user','User','["short_link:read_visits"]'::jsonb,true,now(),now())`)
	require.NoError(t, err)
	tx, err := pool.BeginTx(t.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	require.NoError(t, err)
	defer tx.Rollback(t.Context())
	resolver := permission.NewDatabaseService(pool)
	before, err := resolver.ResolveIn(t.Context(), tx, "user")
	require.NoError(t, err)
	require.True(t, before.Has("short_link:read_visits"))
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]'::jsonb where key='user'`)
	require.NoError(t, err)
	inside, err := resolver.ResolveIn(t.Context(), tx, "user")
	require.NoError(t, err)
	require.True(t, inside.Has("short_link:read_visits"))
	current, err := resolver.Resolve(t.Context(), "user")
	require.NoError(t, err)
	require.False(t, current.Has("short_link:read_visits"))
	require.NoError(t, tx.Commit(t.Context()))
}
