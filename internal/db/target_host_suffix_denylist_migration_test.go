package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestTargetHostSuffixDenylistMigrationPreservesPolicy catches rollback/re-upgrade
// erasing policy/revision/audit or modifying unrelated settings.
func TestTargetHostSuffixDenylistMigrationPreservesPolicy(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 42))
	var legacy string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacy))
	require.NoError(t, goose.UpTo(database, dir, 43))
	var value string
	require.NoError(t, database.QueryRowContext(ctx, `select value::text from system_setting where key='security.target_host_suffix_denylist'`).Scan(&value))
	require.JSONEq(t, `{"suffixes":[]}`, value)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true);update system_setting set value='{"suffixes":["private.example"]}',updated_at='2026-11-12T01:02:03.123456Z' where key='security.target_host_suffix_denylist'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var saved, history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_suffix_denylist'`).Scan(&saved))
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, "private.example")
	require.Contains(t, history, "security.target_host_suffix_denylist")
	require.NoError(t, goose.DownTo(database, dir, 42))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_suffix_denylist'`).Scan(&value))
	require.Equal(t, saved, value)
	require.NoError(t, goose.UpTo(database, dir, 43))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_suffix_denylist'`).Scan(&value))
	require.Equal(t, saved, value)
	var after string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&after))
	require.Equal(t, history, after)
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'security.target_host_suffix_denylist'`).Scan(&after))
	require.Equal(t, legacy, after)
}
