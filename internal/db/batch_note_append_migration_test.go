package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteAppendMigrationEmptyRoundTrip catches an absent receipt table or an irreversible unused migration.
func TestBatchNoteAppendMigrationEmptyRoundTrip(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 36))
	assertRelationExists(t, ctx, database, "short_link_note_append_batch", true)
	require.NoError(t, goose.DownTo(database, dir, 35))
	assertRelationExists(t, ctx, database, "short_link_note_append_batch", false)
	require.NoError(t, goose.UpTo(database, dir, 36))
	assertRelationExists(t, ctx, database, "short_link_note_append_batch", true)
}

// TestBatchNoteAppendMigrationPreservesUsedReceipts catches invalid receipts and rollback that loses committed replay protection.
func TestBatchNoteAppendMigrationPreservesUsedReceipts(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 36))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link_note_append_batch(actor_id,request_id,request_hash,appended_count) values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),2)`)
	require.NoError(t, err)
	for _, invalid := range []string{
		`insert into short_link_note_append_batch(actor_id,request_id,request_hash,appended_count) values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),2)`,
		`update short_link_note_append_batch set appended_count=0`,
		`update short_link_note_append_batch set appended_count=101`,
		`update short_link_note_append_batch set request_hash=decode(repeat('00',31),'hex')`,
		`update short_link_note_append_batch set request_hash=null`,
		`update short_link_note_append_batch set request_id='00000000-0000-0000-0000-000000000000'`,
		`update short_link_note_append_batch set actor_id='00000000-0000-0000-0000-000000000299'`,
	} {
		_, err = database.ExecContext(ctx, invalid)
		require.Error(t, err, invalid)
	}
	const snapshot = `select jsonb_build_object('receipts',(select jsonb_agg(to_jsonb(b) order by actor_id,request_id) from short_link_note_append_batch b),'users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),'version',(select max(version_id) from goose_db_version where is_applied))::text`
	var before, after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
	require.Error(t, goose.DownTo(database, dir, 35), "used append receipts must remain available for replay")
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)
}

func TestBatchNoteAppendMigrationDownSerializesAgainstNewReceipts(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 36))
	insertUserGroups(t, ctx, database)
	connection, err := database.Conn(ctx)
	require.NoError(t, err)
	defer connection.Close()
	lockTx, err := connection.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer func() { _ = lockTx.Rollback() }()
	_, err = lockTx.ExecContext(ctx, `lock table short_link_note_append_batch in access exclusive mode`)
	require.NoError(t, err)

	downResult := make(chan error, 1)
	go func() { downResult <- goose.DownTo(database, dir, 35) }()
	waitForReceiptTableLock(t, ctx, database, `lower(query) like '%lock table short_link_note_append_batch%'`, 1)

	insertResult := make(chan error, 1)
	go func() {
		_, insertErr := database.ExecContext(ctx, `insert into short_link_note_append_batch(actor_id,request_id,request_hash,appended_count) values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),1)`)
		insertResult <- insertErr
	}()
	waitForReceiptTableLock(t, ctx, database, `lower(query) like '%insert into short_link_note_append_batch%'`, 1)
	require.NoError(t, lockTx.Commit())

	var downErr, insertErr error
	select {
	case downErr = <-downResult:
	case <-time.After(5 * time.Second):
		t.Fatal("migration down did not finish after releasing the table lock")
	}
	select {
	case insertErr = <-insertResult:
	case <-time.After(5 * time.Second):
		t.Fatal("receipt insert did not finish after releasing the table lock")
	}
	assertRelationExists(t, ctx, database, "short_link_note_append_batch", downErr != nil)
	if downErr == nil {
		require.Error(t, insertErr, "insert must not commit after the locked table has been dropped")
	} else {
		require.NoError(t, insertErr, "receipt must commit before a refused rollback")
		var count int
		require.NoError(t, database.QueryRowContext(ctx, `select count(*) from short_link_note_append_batch`).Scan(&count))
		require.Equal(t, 1, count)
	}
}

// TestBatchNoteAppendMigrationDownWaitsForCommittedReceipt catches rollback that checks before acquiring the table lock.
func TestBatchNoteAppendMigrationDownWaitsForCommittedReceipt(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 36))
	insertUserGroups(t, ctx, database)
	writer, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	defer writer.Rollback()
	_, err = writer.ExecContext(ctx, `insert into short_link_note_append_batch(actor_id,request_id,request_hash,appended_count) values('00000000-0000-0000-0000-000000000201','8afed221-bffc-4a61-a93e-4f8e13cdf8d1',decode(repeat('00',32),'hex'),1)`)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { done <- goose.DownTo(database, dir, 35) }()
	waitForReceiptTableLock(t, ctx, database, `lower(query) like '%lock table short_link_note_append_batch%'`, 1)
	require.NoError(t, writer.Commit())
	select {
	case err := <-done:
		require.Error(t, err)
	case <-time.After(5 * time.Second):
		t.Fatal("rollback did not finish after receipt commit")
	}
	assertRelationExists(t, ctx, database, "short_link_note_append_batch", true)
	var count, version int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from short_link_note_append_batch`).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, database.QueryRowContext(ctx, `select max(version_id) from goose_db_version where is_applied`).Scan(&version))
	require.Equal(t, 36, version)
}

func waitForReceiptTableLock(t *testing.T, ctx context.Context, database *sql.DB, predicate string, want int) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		err := database.QueryRowContext(ctx, `select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and `+predicate).Scan(&count)
		require.NoError(t, err)
		if count >= want {
			return
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			t.Fatalf("timed out waiting for %d receipt-table lock waiter; found %d", want, count)
		}
	}
}
