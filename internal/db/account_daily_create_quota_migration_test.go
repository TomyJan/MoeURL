package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestDailyCreateQuotaMigration catches destructive rollback/re-upgrade erasing
// today's quota or changing retained policy, revisions, audit and other keys.
func TestDailyCreateQuotaMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 40))
	insertUserGroups(t, ctx, database)
	var legacy string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacy))
	require.NoError(t, goose.UpTo(database, dir, 41))
	var value string
	require.NoError(t, database.QueryRowContext(ctx, `select value::text from system_setting where key='security.account_daily_create_quota'`).Scan(&value))
	require.JSONEq(t, `{"dailyLimit":null}`, value)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true);update system_setting set value='{"dailyLimit":17}',updated_at='2026-11-12T01:02:03.123456Z' where key='security.account_daily_create_quota'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var policy, history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.account_daily_create_quota'`).Scan(&policy))
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, `dailyLimit`)
	require.NoError(t, goose.DownTo(database, dir, 40))
	require.NoError(t, goose.UpTo(database, dir, 41))
	_, err = database.ExecContext(ctx, `insert into account_daily_create_usage(actor_id,usage_day,used) values('00000000-0000-0000-0000-000000000201',(pg_catalog.clock_timestamp() at time zone 'UTC')::date-1,17)`)
	require.NoError(t, err)
	require.NoError(t, goose.DownTo(database, dir, 40))
	require.NoError(t, goose.UpTo(database, dir, 41))
	for _, offset := range []int{0, 1} {
		_, err = database.ExecContext(ctx, `insert into account_daily_create_usage(actor_id,usage_day,used) values('00000000-0000-0000-0000-000000000201',(pg_catalog.clock_timestamp() at time zone 'UTC')::date+$1::integer,1) on conflict(actor_id) do update set usage_day=excluded.usage_day,used=excluded.used`, offset)
		require.NoError(t, err)
		require.ErrorContains(t, goose.DownTo(database, dir, 40), "cannot rollback daily create quota with current or future usage")
		version, err := goose.GetDBVersion(database)
		require.NoError(t, err)
		require.Equal(t, int64(41), version)
		var used int
		require.NoError(t, database.QueryRowContext(ctx, `select used from account_daily_create_usage`).Scan(&used))
		require.Equal(t, 1, used)
	}
	for _, sql := range []string{`update account_daily_create_usage set used=-1`, `update account_daily_create_usage set usage_day='infinity'::date`} {
		_, err = database.ExecContext(ctx, sql)
		require.Error(t, err)
	}
	_, err = database.ExecContext(ctx, `update account_daily_create_usage set usage_day=(pg_catalog.clock_timestamp() at time zone 'UTC')::date-1`)
	require.NoError(t, err)
	require.NoError(t, goose.DownTo(database, dir, 40))
	require.NoError(t, goose.UpTo(database, dir, 41))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='security.account_daily_create_quota'`).Scan(&value))
	require.Equal(t, policy, value)
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(a) order by id)::text from audit_log a`).Scan(&value))
	require.Equal(t, history, value)
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key<>'security.account_daily_create_quota'`).Scan(&value))
	require.Equal(t, legacy, value)
}
