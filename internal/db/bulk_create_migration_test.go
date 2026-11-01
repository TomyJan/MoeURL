package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestBulkCreateMigrationPreservesUsedReceipts catches rollback that would allow an already committed batch to be created again.
func TestBulkCreateMigrationPreservesUsedReceipts(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 32))
	require.NoError(t, goose.Up(database, dir))
	assertRelationExists(t, ctx, database, "short_link_create_batch", true)
	require.NoError(t, goose.DownTo(database, dir, 32))
	assertRelationExists(t, ctx, database, "short_link_create_batch", false)
	require.NoError(t, goose.Up(database, dir))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link_create_batch(actor_id,request_id,request_hash,created_count) values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),2)`)
	require.NoError(t, err)
	for _, invalid := range []string{
		`update short_link_create_batch set created_count=0`,
		`update short_link_create_batch set created_count=21`,
		`update short_link_create_batch set request_hash=decode(repeat('00',31),'hex')`,
		`update short_link_create_batch set request_hash=null`,
		`update short_link_create_batch set request_id='00000000-0000-0000-0000-000000000000'`,
		`update short_link_create_batch set actor_id='00000000-0000-0000-0000-000000000299'`,
	} {
		_, err = database.ExecContext(ctx, invalid)
		require.Error(t, err, invalid)
	}
	var before string
	const snapshot = `select jsonb_build_object('receipts',(select jsonb_agg(to_jsonb(b) order by request_id) from short_link_create_batch b),'users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u))::text`
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
	require.Error(t, goose.DownTo(database, dir, 32), "used idempotency history must not be silently removed")
	var after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)
}
