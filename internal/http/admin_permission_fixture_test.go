package http_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// normalizeTestAdminPermissions keeps router fixtures aligned with the protected built-in admin contract.
func normalizeTestAdminPermissions(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	encoded, err := json.Marshal(permission.AdminPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, "update user_group set permissions=$1::jsonb where key='admin'", string(encoded))
	require.NoError(t, err)
}
