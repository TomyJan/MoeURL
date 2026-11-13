package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestTargetCIDRAllowlistMigration catches destructive Down/re-Up or audit values
// leaking instead of retaining the exact policy, revision and prior history.
func TestTargetCIDRAllowlistMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 46))
	var legacy string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacy))
	require.NoError(t, goose.UpTo(database, dir, 47))
	var value string
	require.NoError(t, database.QueryRowContext(ctx, `select value::text from system_setting where key='security.target_cidr_allowlist'`).Scan(&value))
	require.JSONEq(t, `{"enabled":false,"prefixes":[]}`, value)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true);update system_setting set value='{"enabled":true,"prefixes":["203.0.113.0/24"]}',updated_at='2026-11-13T01:02:03.123456Z' where key='security.target_cidr_allowlist'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var saved, history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_cidr_allowlist'`).Scan(&saved))
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, "203.0.113.0/24")
	require.Contains(t, history, "security.target_cidr_allowlist")
	require.NoError(t, goose.DownTo(database, dir, 46))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_cidr_allowlist'`).Scan(&value))
	require.Equal(t, saved, value)
	require.NoError(t, goose.UpTo(database, dir, 47))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_cidr_allowlist'`).Scan(&value))
	require.Equal(t, saved, value)
	var after string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&after))
	require.Equal(t, history, after)
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'security.target_cidr_allowlist'`).Scan(&after))
	require.Equal(t, legacy, after)
}
