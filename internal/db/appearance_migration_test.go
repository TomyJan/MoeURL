package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestAppearanceMigrationPreservesChoice catches a missing default or a rollback
// and re-upgrade that overwrites a saved accent, revision, or unrelated setting.
func TestAppearanceMigrationPreservesChoice(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 29))
	var legacyBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacyBefore))
	require.NoError(t, goose.UpTo(database, dir, 30))
	var preset string
	require.NoError(t, database.QueryRowContext(ctx, `select value->>'accentPreset' from system_setting where key='site.appearance'`).Scan(&preset))
	require.Equal(t, "iris", preset)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000301',true)`)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `update system_setting set value='{"accentPreset":"forest"}',updated_at='2026-10-30T01:02:03.123456Z' where key='site.appearance'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var savedBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.appearance'`).Scan(&savedBefore))
	var auditBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)::text from audit_log a`).Scan(&auditBefore))
	require.NotEqual(t, "[]", auditBefore, "roundtrip must exercise existing audit history")
	require.NoError(t, goose.DownTo(database, dir, 29))
	var savedAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.appearance'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "rollback must retain the chosen accent and complete revision")
	require.NoError(t, goose.UpTo(database, dir, 30))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.appearance'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "re-upgrade must not replace the saved accent")
	var legacyAfter, auditAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key <> 'site.appearance'`).Scan(&legacyAfter))
	require.Equal(t, legacyBefore, legacyAfter, "old settings and their complete revisions must not change")
	require.NoError(t, database.QueryRowContext(ctx, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)::text from audit_log a`).Scan(&auditAfter))
	require.Equal(t, auditBefore, auditAfter, "migration roundtrip must preserve all audit history")
}

// TestAppearanceAuditContainsOnlyChangedKey catches missing or duplicate audit,
// value disclosure, and audit noise from no-op or unopted writes.
func TestAppearanceAuditContainsOnlyChangedKey(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	require.NoError(t, goose.Up(database, filepath.Join("..", "..", "migrations")))
	// Seed independently, so a missing default cannot hide a missing audit trigger.
	_, err := database.ExecContext(ctx, `insert into system_setting(key,value,created_at,updated_at) values('site.appearance','{"accentPreset":"iris"}',now(),now()) on conflict(key) do nothing`)
	require.NoError(t, err)
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000301',true)`)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `update system_setting set value='{"accentPreset":"forest"}' where key='site.appearance'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count, "one actual accent change must produce exactly one audit record")
	var metadata string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log`).Scan(&metadata))
	require.JSONEq(t, `{"actor":"00000000-0000-0000-0000-000000000301","resource":"system_setting","id":"site.appearance","action":"settings_change","fields":["site.appearance"]}`, metadata)
	var history string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(a)::text from audit_log a`).Scan(&history))
	require.NotContains(t, history, "forest")
	require.NotContains(t, history, "accentPreset")
	tx, err = database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback() }()
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true); update system_setting set value=value,updated_at=clock_timestamp() where key='site.appearance'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	_, err = database.ExecContext(ctx, `update system_setting set value='{"accentPreset":"ocean"}' where key='site.appearance'`)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count, "no-op and unopted writes must not add audit records")
}
