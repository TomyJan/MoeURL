package db_test

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestShortLinkNoteMigration catches missing defaults, unbounded storage and rollback that destroys live or soft-deleted notes.
func TestShortLinkNoteMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 34))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		values('00000000-0000-0000-0000-000000000435','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','notemigration','https://example.com/original','active',now(),now())`)
	require.NoError(t, err)
	require.NoError(t, goose.Up(database, dir))
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from information_schema.columns where table_name='short_link' and column_name in ('note','note_updated_at')`).Scan(&count))
	require.Equal(t, 2, count, "the note and its independent concurrency version must exist")
	var note, oldSnapshot, after string
	const snapshot = `select (to_jsonb(l)-'note'-'note_updated_at')::text from short_link l where slug='notemigration'`
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&oldSnapshot))
	require.NoError(t, database.QueryRowContext(ctx, `select note from short_link where slug='notemigration' and note_updated_at is not null`).Scan(&note))
	require.Empty(t, note)
	_, err = database.ExecContext(ctx, `update short_link set note=$1`, strings.Repeat("😀", 1000))
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `update short_link set note=$1`, strings.Repeat("😀", 1001))
	require.Error(t, err)
	_, err = database.ExecContext(ctx, `update short_link set note=null`)
	require.Error(t, err)
	_, err = database.ExecContext(ctx, `update short_link set note_updated_at=null`)
	require.Error(t, err)
	require.Error(t, goose.DownTo(database, dir, 34), "nonempty notes must prevent destructive rollback")
	_, err = database.ExecContext(ctx, `update short_link set deleted_at=now()`)
	require.NoError(t, err)
	require.Error(t, goose.DownTo(database, dir, 34), "soft-deleted notes also need protection")
	_, err = database.ExecContext(ctx, `update short_link set note='',deleted_at=null`)
	require.NoError(t, err)
	require.NoError(t, goose.DownTo(database, dir, 34))
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, oldSnapshot, after)
	require.NoError(t, goose.Up(database, dir))
	require.NoError(t, database.QueryRowContext(ctx, `select note from short_link where slug='notemigration'`).Scan(&note))
	require.Empty(t, note)
}
