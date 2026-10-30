package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestFooterLinksMigrationPreservesHistory catches missing defaults and upgrades
// or rollbacks that replace saved ordering, complete revisions, or audit history.
func TestFooterLinksMigrationPreservesHistory(t *testing.T) {
	ctx := t.Context()
	database, pool := footerLinksMigrationDatabase(t)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 30))
	var legacyBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s`).Scan(&legacyBefore))
	require.NoError(t, goose.Up(database, dir))
	var initial string
	require.NoError(t, database.QueryRowContext(ctx, `select value::text from system_setting where key='site.footer_links'`).Scan(&initial))
	require.JSONEq(t, `{"links":[]}`, initial)

	footerLinksMigrationAuditWrite(t, pool, `update system_setting set value=$1::jsonb,updated_at='2026-10-30T01:02:03.123456Z' where key='site.footer_links'`, `{"links":[{"label":"Policy","url":"https://example.com/policy"},{"label":"Docs","url":"http://localhost:8080/docs"}]}`)
	var savedBefore, auditBefore string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.footer_links'`).Scan(&savedBefore))
	require.NoError(t, database.QueryRowContext(ctx, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)::text from audit_log a`).Scan(&auditBefore))
	require.NotEqual(t, "[]", auditBefore, "roundtrip must exercise nonempty audit history")
	require.NoError(t, goose.DownTo(database, dir, 30))
	var savedAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.footer_links'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "Down must preserve links and the complete revision")
	require.NoError(t, goose.UpTo(database, dir, 31))
	require.NoError(t, database.QueryRowContext(ctx, `select to_jsonb(s)::text from system_setting s where key='site.footer_links'`).Scan(&savedAfter))
	require.Equal(t, savedBefore, savedAfter, "re-upgrade must preserve the saved ordered list")
	var legacyAfter, auditAfter string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_agg(to_jsonb(s) order by key)::text from system_setting s where key <> 'site.footer_links'`).Scan(&legacyAfter))
	require.Equal(t, legacyBefore, legacyAfter, "all unrelated setting rows and revisions remain unchanged")
	require.NoError(t, database.QueryRowContext(ctx, `select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]'::jsonb)::text from audit_log a`).Scan(&auditAfter))
	require.Equal(t, auditBefore, auditAfter, "roundtrip must preserve complete nonempty audit history")
}

// TestFooterLinksAuditIsolation catches missing or duplicate key-only audit,
// content disclosure, and audit noise from no-op, revision-only or unopted writes.
func TestFooterLinksAuditIsolation(t *testing.T) {
	ctx := t.Context()
	database, pool := footerLinksMigrationDatabase(t)
	require.NoError(t, goose.Up(database, filepath.Join("..", "..", "migrations")))
	_, err := database.ExecContext(ctx, `insert into system_setting(key,value,created_at,updated_at) values('site.footer_links','{"links":[]}',now(),now()) on conflict(key) do nothing`)
	require.NoError(t, err)
	footerLinksMigrationAuditWrite(t, pool, `update system_setting set value=$1::jsonb where key='site.footer_links'`, `{"links":[{"label":"Private policy","url":"https://example.com/private?secret=never-audit"}]}`)
	var count int
	require.NoError(t, database.QueryRowContext(ctx, "select count(*) from audit_log").Scan(&count))
	require.Equal(t, 1, count, "one actual list change must produce exactly one audit record")
	var metadata string
	require.NoError(t, database.QueryRowContext(ctx, `select jsonb_build_object('actor',actor_id,'resource',resource_type,'id',resource_id,'action',action,'fields',changed_fields)::text from audit_log`).Scan(&metadata))
	require.JSONEq(t, `{"actor":"00000000-0000-0000-0000-000000000351","resource":"system_setting","id":"site.footer_links","action":"settings_change","fields":["site.footer_links"]}`, metadata)
	var fullRecord string
	require.NoError(t, database.QueryRowContext(ctx, "select to_jsonb(a)::text from audit_log a").Scan(&fullRecord))
	require.NotContains(t, fullRecord, "Private policy")
	require.NotContains(t, fullRecord, "example.com")
	require.NotContains(t, fullRecord, "never-audit")
	require.NotContains(t, fullRecord, `"links"`)
	footerLinksMigrationAuditWrite(t, pool, `update system_setting set value=value,updated_at=clock_timestamp() where key='site.footer_links'`)
	_, err = database.ExecContext(ctx, `update system_setting set value='{"links":[]}' where key='site.footer_links'`)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, "select count(*) from audit_log").Scan(&count))
	require.Equal(t, 1, count, "no-op, revision-only and unopted writes must not add audit")
}

func footerLinksMigrationDatabase(t *testing.T) (*sql.DB, *pgxpool.Pool) {
	t.Helper()
	ctx := t.Context()
	databaseURL := testdb.DatabaseURL(ctx, t)
	database, err := sql.Open("pgx", databaseURL)
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, database.Close()) })
	pool, err := pgxpool.New(ctx, databaseURL)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, goose.SetDialect("postgres"))
	return database, pool
}

func footerLinksMigrationAuditWrite(t *testing.T, pool *pgxpool.Pool, query string, args ...any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() {
		rollbackContext, cancelRollback := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelRollback()
		_ = tx.Rollback(rollbackContext)
	}()
	_, err = tx.Exec(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000351',true)`)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, query, args...)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
}
