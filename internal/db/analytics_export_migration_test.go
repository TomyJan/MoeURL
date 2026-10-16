package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestAnalyticsExportPermissionMigrationRoundTrip preserves user-managed grants and every existing slug on rollback.
func TestAnalyticsExportPermissionMigrationRoundTrip(t *testing.T) {
	for _, test := range []struct {
		name, before, after string
		retained            bool
	}{
		{"migration owned", "", "", false},
		{"preexisting", "update user_group set permissions=permissions || '[\"short_link:export_statistics\"]'::jsonb where key='user'", "", true},
		{"removed and restored", "", "update user_group set permissions=permissions-'short_link:export_statistics' where key='user'; update user_group set permissions=permissions || '[\"short_link:export_statistics\"]'::jsonb where key='user'", true},
		{"removed", "", "update user_group set permissions=permissions-'short_link:export_statistics' where key='user'", false},
		{"unrelated edit", "", `update user_group set permissions=permissions || '["future:permission"]'::jsonb,name='renamed' where key='user'`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 18))
			insertUserGroups(t, ctx, database)
			if test.before != "" {
				_, err := database.ExecContext(ctx, test.before)
				require.NoError(t, err)
			}
			_, err := database.ExecContext(ctx, `update user_group set updated_at='2020-01-01T00:00:00Z'`)
			require.NoError(t, err)
			require.NoError(t, goose.UpTo(database, dir, 19))
			require.NoError(t, goose.UpTo(database, dir, 19))
			assertAnalyticsExportPermission(t, database, "user", true)
			assertAnalyticsExportPermission(t, database, "admin", true)
			assertAnalyticsExportPermission(t, database, "guest", false)
			for _, group := range []string{"user", "admin", "guest"} {
				var updated bool
				require.NoError(t, database.QueryRowContext(ctx, `select updated_at > '2020-01-01T00:00:00Z' from user_group where key=$1`, group).Scan(&updated))
				require.Equal(t, group == "admin" || (group == "user" && test.name != "preexisting"), updated)
			}
			_, err = database.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','export1','https://example.com','active',now(),now()); insert into short_link_event(id,short_link_id,event_type,created_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000301','redirect_response_sent',now())`)
			require.NoError(t, err)
			if test.after != "" {
				_, err := database.ExecContext(ctx, test.after)
				require.NoError(t, err)
			}
			require.NoError(t, goose.DownTo(database, dir, 18))
			assertAnalyticsExportPermission(t, database, "user", test.retained)
			assertAnalyticsExportPermission(t, database, "admin", false)
			if test.name == "unrelated edit" {
				var retained bool
				require.NoError(t, database.QueryRowContext(ctx, `select permissions ? 'future:permission' and name='renamed' from user_group where key='user'`).Scan(&retained))
				require.True(t, retained)
			}
			var slug string
			require.NoError(t, database.QueryRowContext(ctx, `select slug from short_link`).Scan(&slug))
			require.Equal(t, "export1", slug)
			var events int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from short_link_event`).Scan(&events))
			require.Equal(t, 1, events)
			require.NoError(t, goose.UpTo(database, dir, 19))
			assertAnalyticsExportPermission(t, database, "user", true)
		})
	}
	t.Run("post migration insertion and grant", func(t *testing.T) {
		ctx := t.Context()
		database := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(database, dir, 19))
		insertUserGroups(t, ctx, database)
		_, err := database.ExecContext(ctx, `update user_group set permissions=permissions || '["short_link:export_statistics"]'::jsonb where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.DownTo(database, dir, 18))
		assertAnalyticsExportPermission(t, database, "user", true)
		assertAnalyticsExportPermission(t, database, "admin", true)
		require.NoError(t, goose.UpTo(database, dir, 19))
	})
	t.Run("nonbuiltin groups remain unchanged", func(t *testing.T) {
		ctx := t.Context()
		database := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(database, dir, 18))
		insertUserGroups(t, ctx, database)
		_, err := database.ExecContext(ctx, `update user_group set builtin=false where key in ('user','admin'); insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at) values(gen_random_uuid(),'custom','Custom','', '["short_link:export_statistics"]'::jsonb,false,now(),now())`)
		require.NoError(t, err)
		require.NoError(t, goose.UpTo(database, dir, 19))
		assertAnalyticsExportPermission(t, database, "user", false)
		assertAnalyticsExportPermission(t, database, "admin", false)
		require.NoError(t, goose.DownTo(database, dir, 18))
		assertAnalyticsExportPermission(t, database, "custom", true)
	})
}

// assertAnalyticsExportPermission checks persisted migration behavior independently of application defaults.
func assertAnalyticsExportPermission(t *testing.T, database *sql.DB, key string, want bool) {
	t.Helper()
	var got bool
	require.NoError(t, database.QueryRowContext(t.Context(), `select permissions ? 'short_link:export_statistics' from user_group where key=$1`, key).Scan(&got))
	require.Equal(t, want, got, key)
}
