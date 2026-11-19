package db_test

import (
	"fmt"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestManifestRestoreReceiptMigrationRoundTrip catches losing old receipts or failing to restore the old capacity on Down.
func TestManifestRestoreReceiptMigrationRoundTrip(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 47))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link_create_batch(actor_id,request_id,request_hash,created_count)
		values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),20)`)
	require.NoError(t, err)
	const snapshot = `select jsonb_agg(to_jsonb(b) order by request_id)::text from short_link_create_batch b`
	var before, after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))

	for round := 0; round < 2; round++ {
		require.NoError(t, goose.UpTo(database, dir, 48))
		version, err := goose.GetDBVersion(database)
		require.NoError(t, err)
		require.EqualValues(t, 48, version)
		require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
		require.Equal(t, before, after, "Up must preserve the exact historical receipt")
	}
	require.NoError(t, goose.DownTo(database, dir, 47))
	version, err := goose.GetDBVersion(database)
	require.NoError(t, err)
	require.EqualValues(t, 47, version)
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after, "Down must preserve used receipts")
	_, err = database.ExecContext(ctx, `update short_link_create_batch set created_count=21`)
	var constraintError *pgconn.PgError
	require.ErrorAs(t, err, &constraintError)
	require.Equal(t, "23514", constraintError.Code)
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)

	require.NoError(t, goose.UpTo(database, dir, 48))
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after, "reapplying Up must not recreate or alter history")
	_, err = database.ExecContext(ctx, `update short_link_create_batch set created_count=21`)
	require.NoError(t, err, "reapplying Up must make a manifest-sized receipt usable again")
}

// TestManifestRestoreReceiptMigrationRefusesUnsafeDown catches partial rollback, a wrong limit or lost replay history after a failed Down.
func TestManifestRestoreReceiptMigrationRefusesUnsafeDown(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 48))
	insertUserGroups(t, ctx, database)
	for index, count := range []int{1, 20, 21, 100} {
		_, err := database.ExecContext(ctx, `insert into short_link_create_batch(actor_id,request_id,request_hash,created_count)
			values('00000000-0000-0000-0000-000000000201',$1::uuid,decode(repeat('ab',32),'hex'),$2)`,
			fmt.Sprintf("8afed221-bffc-4a61-a93e-%012d", index+1), count)
		require.NoError(t, err)
	}
	for _, count := range []int{0, 101} {
		_, err := database.ExecContext(ctx, `update short_link_create_batch set created_count=$1`, count)
		var constraintError *pgconn.PgError
		require.ErrorAs(t, err, &constraintError)
		require.Equal(t, "23514", constraintError.Code)
	}
	const snapshot = `select jsonb_build_object(
		'receipts',(select jsonb_agg(to_jsonb(b) order by request_id) from short_link_create_batch b),
		'versions',(select jsonb_agg(to_jsonb(v) order by id) from goose_db_version v),
		'constraint',(select pg_get_constraintdef(oid) from pg_constraint where conrelid='short_link_create_batch'::regclass
			and conname='short_link_create_batch_created_count_check'))::text`
	var before, after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
	for attempt := 0; attempt < 2; attempt++ {
		err := goose.DownTo(database, dir, 47)
		require.ErrorContains(t, err, "cannot reduce receipt capacity while larger manifest restore receipts exist")
		version, err := goose.GetDBVersion(database)
		require.NoError(t, err)
		require.EqualValues(t, 48, version, "a failed Down must leave Goose on the applied version")
		require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
		require.Equal(t, before, after, "failed Down must preserve data, constraint and Goose history")
	}
	require.NoError(t, goose.UpTo(database, dir, 48), "a failed Down must not prevent a safe Up retry")
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)
}
