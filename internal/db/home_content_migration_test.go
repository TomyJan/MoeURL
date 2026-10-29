package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestHomeContentMigrationPreservesSavedCopy catches missing defaults and a
// rollback/re-upgrade that erases administrator-authored homepage content.
func TestHomeContentMigrationPreservesSavedCopy(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 28))
	var legacyBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacyBefore))
	require.NoError(t, goose.Up(database, dir))
	var title, summary string
	require.NoError(t, database.QueryRowContext(ctx, `select value->>'title',value->>'summary' from system_setting where key='site.home_content'`).Scan(&title, &summary))
	require.Empty(t, title)
	require.Empty(t, summary)
	_, err := database.ExecContext(ctx, `update system_setting set value='{"title":"Our links","summary":"Independent service"}',updated_at='2026-10-29T01:02:03.123456Z' where key='site.home_content'`)
	require.NoError(t, err)
	var savedBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.home_content'`).Scan(&savedBefore))
	require.NoError(t, goose.DownTo(database, dir, 28))
	var savedAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.home_content'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "rollback must preserve content and its revision")
	require.NoError(t, goose.Up(database, dir))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.home_content'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "re-upgrade must not replace saved copy with defaults")
	var legacyAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key <> 'site.home_content'`).Scan(&legacyAfter))
	require.Equal(t, legacyBefore, legacyAfter, "legacy settings and revisions must remain independent")
}

// TestHomeContentAuditContainsOnlyChangedKey catches missing/double audit,
// content-value disclosure and audit noise from no-op or unopted writes.
func TestHomeContentAuditContainsOnlyChangedKey(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	require.NoError(t, goose.Up(database, filepath.Join("..", "..", "migrations")))
	// Seed independently of migration defaults so this test specifically detects
	// audit behavior; the separate roundtrip test detects a missing default row.
	_, err := database.ExecContext(ctx, `insert into system_setting(key,value,created_at,updated_at) values('site.home_content','{"title":"","summary":""}',now(),now()) on conflict(key) do nothing`)
	require.NoError(t, err)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true)`)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `update system_setting set value='{"title":"Private editorial draft","summary":"<script>still text</script>"}' where key='site.home_content'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count, "one actual content change must create exactly one audit record")
	var metadata string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log`).Scan(&metadata))
	require.JSONEq(t, `{"actor":"00000000-0000-0000-0000-000000000201","resource":"system_setting","id":"site.home_content","action":"settings_change","fields":["site.home_content"]}`, metadata)
	var history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(a)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, "Private editorial draft")
	require.NotContains(t, history, "<script>")
	tx, err = database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true); update system_setting set value=value,updated_at=clock_timestamp() where key='site.home_content'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	_, err = database.ExecContext(ctx, `update system_setting set value='{"title":"Unopted maintenance","summary":""}' where key='site.home_content'`)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count, "no-op and unopted writes must not add audit noise")
}
