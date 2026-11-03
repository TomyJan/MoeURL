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

// TestShortLinkNoteAuditCompatibility catches added note fields in legacy create/delete audits and missing or duplicate update audits across rollback.
func TestShortLinkNoteAuditCompatibility(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 34))
	insertUserGroups(t, ctx, database)
	const legacyFields = `["slug","owner_id","domain_id","target_url","status","redirect_mode","intermediate_delay_seconds","expires_at","password_hash","max_visits","title","tags","deleted_at"]`
	const linkID = "00000000-0000-0000-0000-000000000436"
	checkWrite := func(t *testing.T, query, action, fields string) {
		t.Helper()
		var previous int64
		require.NoError(t, database.QueryRowContext(ctx, `select coalesce(max(id),0) from audit_log`).Scan(&previous))
		tx, err := database.BeginTx(ctx, nil)
		require.NoError(t, err)
		defer tx.Rollback()
		_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true)`)
		require.NoError(t, err)
		_, err = tx.ExecContext(ctx, query)
		require.NoError(t, err)
		require.NoError(t, tx.Commit())
		rows, err := database.QueryContext(ctx, `select action,array_to_json(changed_fields)::text,actor_id::text,resource_type,resource_id from audit_log where id>$1 order by id`, previous)
		require.NoError(t, err)
		defer rows.Close()
		if action != "" {
			require.True(t, rows.Next(), "the actual write needs one audit row")
			var gotAction, gotFields, actor, resource, id string
			require.NoError(t, rows.Scan(&gotAction, &gotFields, &actor, &resource, &id))
			require.Equal(t, action, gotAction)
			require.JSONEq(t, fields, gotFields)
			require.Equal(t, "00000000-0000-0000-0000-000000000201", actor)
			require.Equal(t, "short_link", resource)
			require.Equal(t, linkID, id)
		}
		require.False(t, rows.Next(), "no duplicate audit, including no-op/version-only writes")
		require.NoError(t, rows.Err())
	}
	for _, phase := range []struct {
		name    string
		version int64
		notes   bool
	}{{"before", 34, false}, {"upgrade", 35, true}, {"rollback", 34, false}, {"reupgrade", 35, true}} {
		t.Run(phase.name, func(t *testing.T) {
			t.Cleanup(func() {
				_, err := database.ExecContext(ctx, `delete from short_link where id='`+linkID+`'`)
				require.NoError(t, err)
			})
			check := func(query, action, fields string) {
				t.Helper()
				checkWrite(t, query, action, fields)
			}
			if phase.name == "rollback" {
				require.NoError(t, goose.DownTo(database, dir, phase.version))
			} else {
				require.NoError(t, goose.UpTo(database, dir, phase.version))
			}
			check(`insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values('`+linkID+`','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','noteauditcompat','https://example.com/original','active',now(),now())`, "create", legacyFields)
			check(`update short_link set title='Changed title' where id='`+linkID+`'`, "update", `["title"]`)
			if phase.notes {
				check(`update short_link set note='Private note' where id='`+linkID+`'`, "update", `["note"]`)
				check(`update short_link set note=note,note_updated_at=clock_timestamp() where id='`+linkID+`'`, "", "")
				check(`update short_link set title='Another title' where id='`+linkID+`'`, "update", `["title"]`)
				check(`update short_link set note='' where id='`+linkID+`'`, "update", `["note"]`)
			}
			check(`delete from short_link where id='`+linkID+`'`, "delete", legacyFields)
		})
	}
}
