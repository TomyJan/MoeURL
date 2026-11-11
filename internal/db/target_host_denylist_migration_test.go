package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestTargetHostDenylistMigrationPreservesPolicy catches a rollback/re-upgrade
// erasing custom policy, its exact revision, audit history or unrelated settings.
func TestTargetHostDenylistMigrationPreservesPolicy(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 38))
	var legacy string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacy))
	require.NoError(t, goose.UpTo(database, dir, 39))
	var value string
	require.NoError(t, database.QueryRowContext(ctx, `select value::text from system_setting where key='security.target_host_denylist'`).Scan(&value))
	require.JSONEq(t, `{"hosts":[]}`, value)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true);update system_setting set value='{"hosts":["private.example"]}',updated_at='2026-11-11T01:02:03.123456Z' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var saved, history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_denylist'`).Scan(&saved))
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, "private.example")
	require.Contains(t, history, "security.target_host_denylist")
	require.NoError(t, goose.DownTo(database, dir, 38))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_denylist'`).Scan(&value))
	require.Equal(t, saved, value)
	require.NoError(t, goose.UpTo(database, dir, 39))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.target_host_denylist'`).Scan(&value))
	require.Equal(t, saved, value)
	var after string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&after))
	require.Equal(t, history, after)
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'security.target_host_denylist'`).Scan(&after))
	require.Equal(t, legacy, after)
}
