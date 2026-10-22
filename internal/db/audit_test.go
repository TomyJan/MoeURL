package db_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestAuditTransactionAtomicity verifies that business changes and their audit rows share one commit boundary.
func TestAuditTransactionAtomicity(t *testing.T) {
	ctx := context.Background()
	pool := testdb.ProjectMigratedPool(ctx, t)
	_, err := pool.Exec(ctx, `delete from system_setting where key='site.name'`)
	require.NoError(t, err)
	actor := "11111111-1111-4111-8111-111111111111"
	write := func(fail bool) error {
		return appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `select set_config('moeurl.audit_enabled','on',true), set_config('moeurl.audit_actor',$1,true)`, actor)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `insert into system_setting(key,value,created_at,updated_at) values('site.name','"private value"',now(),now()) on conflict(key) do update set value='"second private value"'`)
			if err != nil {
				return err
			}
			if fail {
				return errors.New("business rollback")
			}
			return nil
		})
	}
	require.NoError(t, write(false))
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='system_setting' and resource_id='site.name' and action='settings_change' and changed_fields=array['site.name']`, actor).Scan(&count))
	require.Equal(t, 1, count)
	require.Error(t, write(true))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
	_, err = pool.Exec(ctx, `alter table audit_log add constraint force_audit_failure check (false) not valid`)
	require.NoError(t, err)
	require.Error(t, write(false))
	var value string
	require.NoError(t, pool.QueryRow(ctx, `select value#>>'{}' from system_setting where key='site.name'`).Scan(&value))
	require.Equal(t, "private value", value)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAuditContextIsolation verifies actor scope never leaks to a reused pool connection and rejects invalid actors before writes.
func TestAuditContextIsolation(t *testing.T) {
	ctx := t.Context()
	base := testdb.ProjectMigratedPool(ctx, t)
	config := base.Config()
	config.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, config)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	write := func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `update system_setting set value=to_jsonb(value::text || 'x') where key='site.name'`)
		return err
	}
	for _, actor := range []string{"not-a-uuid", "00000000-0000-0000-0000-000000000000"} {
		require.Error(t, appdb.WithAuditTx(ctx, pool, actor, write))
	}
	require.NoError(t, appdb.WithAuditTx(ctx, pool, "", write))
	require.NoError(t, appdb.WithTx(ctx, pool, write))
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id is null`).Scan(&count))
	require.Equal(t, 1, count)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	require.NoError(t, tx.Rollback(ctx))
	require.Error(t, appdb.SetAuditContext(ctx, tx, ""))
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.Error(t, appdb.WithAuditTx(canceled, pool, "", write))
}

// TestAuditDownWaitsForWriter verifies rollback sees history committed by a writer that already holds the table lock.
func TestAuditDownWaitsForWriter(t *testing.T) {
	database := migrationTestDatabase(t, t.Context())
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 21))
	writer, err := database.BeginTx(t.Context(), nil)
	require.NoError(t, err)
	defer writer.Rollback()
	_, err = writer.ExecContext(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields) values('user','concurrent','update',array['nickname'])`)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { done <- goose.DownTo(database, dir, 20) }()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	poll := time.NewTicker(time.Millisecond)
	defer poll.Stop()
	for {
		var blocked bool
		require.NoError(t, database.QueryRowContext(t.Context(), `select exists(select 1 from pg_locks where relation='audit_log'::regclass and mode='AccessExclusiveLock' and not granted)`).Scan(&blocked))
		if blocked {
			break
		}
		select {
		case err := <-done:
			t.Fatalf("Down returned before writer completed: %v", err)
		case <-deadline.C:
			t.Fatal("Down never waited for audit writer")
		case <-poll.C:
		}
	}
	require.NoError(t, writer.Commit())
	select {
	case err := <-done:
		require.ErrorContains(t, err, "cannot rollback audit migration")
	case <-time.After(3 * time.Second):
		t.Fatal("Down did not finish after writer commit")
	}
	var count int
	require.NoError(t, database.QueryRowContext(t.Context(), `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAuditRetentionExactBoundary exercises the cleanup SQL with a fixed transaction clock and no recursive audit.
func TestAuditRetentionExactBoundary(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	ctx := t.Context()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	// Shadow only the clock inside this rolled-back test transaction. The real
	// SQLC DELETE still runs unchanged against PostgreSQL, with a known DST span.
	_, err = tx.Exec(ctx, `create schema audit_test_clock; create function audit_test_clock.now() returns timestamptz language sql stable as $$ select '2026-10-22T00:00:00Z'::timestamptz $$; set local search_path = audit_test_clock, pg_catalog, public; set local time zone 'Australia/Sydney'`)
	require.NoError(t, err)
	var fixedNow time.Time
	require.NoError(t, tx.QueryRow(ctx, `select now()`).Scan(&fixedNow))
	require.Equal(t, time.Date(2026, 10, 22, 0, 0, 0, 0, time.UTC), fixedNow.UTC())
	_, err = tx.Exec(ctx, `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values ('user','old','update',array['nickname'],now()-interval '4320 hours 1 microsecond'),('user','boundary','update',array['nickname'],now()-interval '4320 hours'),('user','new','update',array['nickname'],now()-interval '4319 hours 59 minutes 59.999999 seconds')`)
	require.NoError(t, err)
	require.NoError(t, appdb.SetAuditContext(ctx, tx, ""))
	count, err := sqlc.New(tx).DeleteExpiredAuditLogs(ctx)
	require.NoError(t, err)
	require.Equal(t, int64(1), count)
	var ids []string
	require.NoError(t, tx.QueryRow(ctx, `select array_agg(resource_id order by resource_id) from audit_log`).Scan(&ids))
	require.Equal(t, []string{"boundary", "new"}, ids)
}

// TestAuditMigrationRoundTrip protects existing history while allowing empty-schema rollback and re-upgrade.
func TestAuditMigrationRoundTrip(t *testing.T) {
	database := migrationTestDatabase(t, t.Context())
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 21))
	require.NoError(t, goose.DownTo(database, dir, 20))
	require.NoError(t, goose.UpTo(database, dir, 21))
	_, err := database.ExecContext(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields) values('user','history','update',array['nickname'])`)
	require.NoError(t, err)
	require.ErrorContains(t, goose.DownTo(database, dir, 20), "cannot rollback audit migration")
	var count int
	require.NoError(t, database.QueryRowContext(t.Context(), `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
}
