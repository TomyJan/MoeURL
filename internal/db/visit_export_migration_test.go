package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestVisitExportPermissionMigrationRoundTrip catches rollback loss of preexisting and independently restored grants.
func TestVisitExportPermissionMigrationRoundTrip(t *testing.T) {
	for _, test := range []struct {
		name, before, after string
		retained            bool
	}{
		{"migration owned", "", "", false},
		{"preexisting", `update user_group set permissions=permissions || '["short_link:export_visits"]'::jsonb where key='user'`, "", true},
		{"removed restored", "", `update user_group set permissions=permissions-'short_link:export_visits' where key='user'; update user_group set permissions=permissions || '["short_link:export_visits"]'::jsonb where key='user'`, true},
		{"removed", "", `update user_group set permissions=permissions-'short_link:export_visits' where key='user'`, false},
		{"unrelated edit", "", `update user_group set permissions=permissions || '["future:permission"]'::jsonb,name='renamed' where key='user'`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			db := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(db, dir, 22))
			insertUserGroups(t, ctx, db)
			_, err := db.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','preservedvisitexport','https://example.com','active',now(),'2026-01-01Z'); insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),id,'redirect_response_sent',now() from short_link`)
			require.NoError(t, err)
			if test.before != "" {
				_, err := db.ExecContext(ctx, test.before)
				require.NoError(t, err)
			}
			_, err = db.ExecContext(ctx, `update user_group set updated_at='2020-01-01T00:00:00Z'`)
			require.NoError(t, err)
			require.NoError(t, goose.UpTo(db, dir, 23))
			require.NoError(t, goose.UpTo(db, dir, 23))
			for _, key := range []string{"user", "admin", "guest"} {
				var changed bool
				require.NoError(t, db.QueryRowContext(ctx, `select updated_at>'2020-01-01T00:00:00Z' from user_group where key=$1`, key).Scan(&changed))
				require.Equal(t, key == "admin" || (key == "user" && test.name != "preexisting"), changed)
			}
			assertGrant := func(key string, want bool) {
				var got bool
				require.NoError(t, db.QueryRowContext(ctx, `select permissions ? 'short_link:export_visits' from user_group where key=$1`, key).Scan(&got))
				require.Equal(t, want, got, key)
			}
			assertGrant("user", true)
			assertGrant("admin", true)
			assertGrant("guest", false)
			_, err = db.ExecContext(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'late','late','["short_link:export_visits"]',false,now(),now())`)
			require.NoError(t, err)
			if test.after != "" {
				_, err = db.ExecContext(ctx, test.after)
				require.NoError(t, err)
			}
			require.NoError(t, goose.DownTo(db, dir, 22))
			assertGrant("user", test.retained)
			assertGrant("admin", false)
			assertGrant("late", true)
			var unchanged bool
			require.NoError(t, db.QueryRowContext(ctx, `select slug='preservedvisitexport' and updated_at='2026-01-01Z'::timestamptz and (select count(*) from short_link_event)=1 and (select count(*) from audit_log)=0 from short_link`).Scan(&unchanged))
			require.True(t, unchanged)
			if test.name == "unrelated edit" {
				var retained bool
				require.NoError(t, db.QueryRowContext(ctx, `select permissions ? 'future:permission' and name='renamed' from user_group where key='user'`).Scan(&retained))
				require.True(t, retained)
			}
			require.NoError(t, goose.UpTo(db, dir, 23))
			assertGrant("user", true)
		})
	}
	t.Run("groups inserted after migration", func(t *testing.T) {
		ctx := t.Context()
		db := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(db, dir, 23))
		insertUserGroups(t, ctx, db)
		_, err := db.ExecContext(ctx, `update user_group set permissions=permissions || '["short_link:export_visits"]'::jsonb where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.DownTo(db, dir, 22))
		var count int
		require.NoError(t, db.QueryRowContext(ctx, `select count(*) from user_group where permissions ? 'short_link:export_visits'`).Scan(&count))
		require.Equal(t, 2, count)
	})
	t.Run("nonbuiltin groups", func(t *testing.T) {
		ctx := t.Context()
		db := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(db, dir, 22))
		insertUserGroups(t, ctx, db)
		_, err := db.ExecContext(ctx, `update user_group set builtin=false where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.UpTo(db, dir, 23))
		var count int
		require.NoError(t, db.QueryRowContext(ctx, `select count(*) from user_group where permissions ? 'short_link:export_visits'`).Scan(&count))
		require.Zero(t, count)
		require.NoError(t, goose.DownTo(db, dir, 22))
	})
}
