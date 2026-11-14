package targetpolicy_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

// Administrator checks must re-read database grants in the caller-owned read
// transaction; a valid session snapshot cannot preserve a revoked grant.
func TestAuthorizeAdminCheckCurrentGrants(t *testing.T) {
	pool, _, actor := fixture(t)
	tx, err := pool.BeginTx(t.Context(), pgx.TxOptions{AccessMode: pgx.ReadOnly})
	require.NoError(t, err)
	defer testdb.Rollback(t, tx.Rollback)
	q := sqlc.New(tx)
	require.NoError(t, targetpolicy.AuthorizeAdminCheck(t.Context(), q, actor))
	require.ErrorIs(t, targetpolicy.AuthorizeAdminCheck(t.Context(), q, auth.GuestUser()), targetpolicy.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='["admin:access"]' where key='admin'`)
	require.NoError(t, err)
	require.ErrorIs(t, targetpolicy.AuthorizeAdminCheck(t.Context(), q, actor), targetpolicy.ErrPermissionDenied)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='null' where key='admin'`)
	require.NoError(t, err)
	require.ErrorIs(t, targetpolicy.AuthorizeAdminCheck(t.Context(), q, actor), targetpolicy.ErrCorrupt)
}
