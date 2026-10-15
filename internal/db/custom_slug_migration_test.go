package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestCustomSlugPermissionMigrationRoundTrip preserves user-managed grants and every existing slug on rollback.
func TestCustomSlugPermissionMigrationRoundTrip(t *testing.T) {
	for _, test := range []struct {
		name, before, after string
		retained            bool
	}{
		{"migration owned", "", "", false},
		{"preexisting", "update user_group set permissions=permissions || '[\"short_link:custom_slug\"]'::jsonb where key='user'", "", true},
		{"removed and restored", "", "update user_group set permissions=permissions-'short_link:custom_slug' where key='user'; update user_group set permissions=permissions || '[\"short_link:custom_slug\"]'::jsonb where key='user'", true},
		{"removed", "", "update user_group set permissions=permissions-'short_link:custom_slug' where key='user'", false},
		{"unrelated edit", "", `update user_group set permissions=permissions || '["future:permission"]'::jsonb,name='renamed' where key='user'`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 16))
			insertUserGroups(t, ctx, database)
			if test.before != "" {
				_, err := database.ExecContext(ctx, test.before)
				require.NoError(t, err)
			}
			require.NoError(t, goose.UpTo(database, dir, 17))
			assertCustomSlugPermission(t, database, "user", true)
			assertCustomSlugPermission(t, database, "admin", true)
			assertCustomSlugPermission(t, database, "guest", false)
			_, err := database.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','customlongslug123','https://example.com','active',now(),now())`)
			require.NoError(t, err)
			if test.after != "" {
				_, err := database.ExecContext(ctx, test.after)
				require.NoError(t, err)
			}
			require.NoError(t, goose.DownTo(database, dir, 16))
			assertCustomSlugPermission(t, database, "user", test.retained)
			assertCustomSlugPermission(t, database, "admin", false)
			if test.name == "unrelated edit" {
				var retained bool
				require.NoError(t, database.QueryRowContext(ctx, `select permissions ? 'future:permission' and name='renamed' from user_group where key='user'`).Scan(&retained))
				require.True(t, retained)
			}
			var slug string
			require.NoError(t, database.QueryRowContext(ctx, `select slug from short_link`).Scan(&slug))
			require.Equal(t, "customlongslug123", slug)
			require.NoError(t, goose.UpTo(database, dir, 17))
			assertCustomSlugPermission(t, database, "user", true)
		})
	}
	t.Run("post migration insertion and grant", func(t *testing.T) {
		ctx := t.Context()
		database := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(database, dir, 17))
		insertUserGroups(t, ctx, database)
		_, err := database.ExecContext(ctx, `update user_group set permissions=permissions || '["short_link:custom_slug"]'::jsonb where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.DownTo(database, dir, 16))
		assertCustomSlugPermission(t, database, "user", true)
		assertCustomSlugPermission(t, database, "admin", true)
		require.NoError(t, goose.UpTo(database, dir, 17))
	})
}

// assertCustomSlugPermission checks persisted migration behavior independently of application defaults.
func assertCustomSlugPermission(t *testing.T, database *sql.DB, key string, want bool) {
	t.Helper()
	var got bool
	require.NoError(t, database.QueryRowContext(t.Context(), `select permissions ? 'short_link:custom_slug' from user_group where key=$1`, key).Scan(&got))
	require.Equal(t, want, got, key)
}
