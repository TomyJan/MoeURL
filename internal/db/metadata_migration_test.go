package db_test

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestShortLinkMetadataMigrationRoundTrip verifies old-row defaults, bounded storage and reversible schema.
func TestShortLinkMetadataMigrationRoundTrip(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 15))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link (id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		values ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','metadata1','https://example.com','active',now(),now())`)
	require.NoError(t, err)
	require.NoError(t, goose.UpTo(database, dir, 16))
	var title, tags string
	require.NoError(t, database.QueryRowContext(ctx, `select title, tags::text from short_link where slug='metadata1'`).Scan(&title, &tags))
	require.Empty(t, title)
	require.Equal(t, "{}", tags)
	for _, test := range []struct {
		name, statement string
		value           any
	}{
		{"long title", `update short_link set title=$1`, strings.Repeat("猫", 121)},
		{"null title", `update short_link set title=$1`, nil},
		{"null tags", `update short_link set tags=$1::text[]`, nil},
		{"too many tags", `update short_link set tags=$1::text[]`, "{a,b,c,d,e,f,g,h,i,j,k}"},
		{"null element", `update short_link set tags=$1::text[]`, "{a,NULL}"},
		{"empty element", `update short_link set tags=$1::text[]`, `{""}`},
		{"blank element", `update short_link set tags=$1::text[]`, `{"   "}`},
		{"Unicode blank element", `update short_link set tags=$1::text[]`, "{\"\u0085\u00a0\u1680\u2003\u2028\u202f\u205f\u3000\"}"},
		{"long tag", `update short_link set tags=$1::text[]`, "{" + strings.Repeat("猫", 33) + "}"},
		{"multidimensional", `update short_link set tags=$1::text[]`, "{{a,b},{c,d}}"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := database.ExecContext(ctx, test.statement, test.value)
			require.Error(t, err)
		})
	}
	_, err = database.ExecContext(ctx, `update short_link set title=$1, tags=array[$2,'Go','go']`, strings.Repeat("猫", 120), strings.Repeat("猫", 32))
	require.NoError(t, err)
	var indexDefinition string
	require.NoError(t, database.QueryRowContext(ctx, `select indexdef from pg_indexes where indexname='short_link_tags_idx'`).Scan(&indexDefinition))
	require.Contains(t, indexDefinition, "USING gin (tags)")
	require.Contains(t, indexDefinition, "deleted_at IS NULL")
	for key, want := range map[string]bool{"guest": false, "user": true, "admin": true} {
		assertMetadataPermission(t, database, key, want)
	}
	require.NoError(t, goose.DownTo(database, dir, 15))
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from information_schema.columns where table_name='short_link' and column_name in ('title','tags')`).Scan(&count))
	require.Zero(t, count)
	assertRelationExists(t, ctx, database, "short_link_tags_idx", false)
	assertRelationExists(t, ctx, database, "moeurl_short_link_metadata_permission_addition", false)
	for _, key := range []string{"guest", "user", "admin"} {
		assertMetadataPermission(t, database, key, false)
	}
	require.NoError(t, goose.UpTo(database, dir, 16))
	require.NoError(t, database.QueryRowContext(ctx, `select title, tags::text from short_link where slug='metadata1'`).Scan(&title, &tags))
	require.Empty(t, title)
	require.Equal(t, "{}", tags)
}

// TestMetadataPermissionRollbackProvenance preserves independently managed and post-migration permissions.
func TestMetadataPermissionRollbackProvenance(t *testing.T) {
	for _, test := range []struct {
		name          string
		before, after string
		want          bool
	}{
		{"migration owned", "", "", false},
		{"preexisting grant", `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`, "", true},
		{"remove and restore", "", `update user_group set permissions=permissions-'short_link:set_metadata' where key='user'; update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`, true},
		{"independent removal", "", `update user_group set permissions=permissions-'short_link:set_metadata' where key='user'`, false},
		{"unrelated edit", "", `update user_group set permissions=permissions || '["future:permission"]'::jsonb, name='renamed' where key='user'`, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 15))
			insertUserGroups(t, ctx, database)
			if test.before != "" {
				_, err := database.ExecContext(ctx, test.before)
				require.NoError(t, err)
			}
			require.NoError(t, goose.UpTo(database, dir, 16))
			if test.after != "" {
				_, err := database.ExecContext(ctx, test.after)
				require.NoError(t, err)
			}
			require.NoError(t, goose.DownTo(database, dir, 15))
			assertMetadataPermission(t, database, "user", test.want)
			assertMetadataPermission(t, database, "admin", false)
			if test.name == "unrelated edit" {
				var retained bool
				require.NoError(t, database.QueryRowContext(ctx, `select permissions ? 'future:permission' and name='renamed' from user_group where key='user'`).Scan(&retained))
				require.True(t, retained)
			}
			require.NoError(t, goose.UpTo(database, dir, 16))
			assertMetadataPermission(t, database, "user", true)
		})
	}
	// Empty-database Up owns no subsequent inserts or grants, including groups provisioned by bootstrap.
	t.Run("later inserts and grants", func(t *testing.T) {
		ctx := t.Context()
		database := migrationTestDatabase(t, ctx)
		dir := filepath.Join("..", "..", "migrations")
		require.NoError(t, goose.UpTo(database, dir, 16))
		insertUserGroups(t, ctx, database)
		_, err := database.ExecContext(ctx, `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key in ('user','admin')`)
		require.NoError(t, err)
		require.NoError(t, goose.DownTo(database, dir, 15))
		assertMetadataPermission(t, database, "user", true)
		assertMetadataPermission(t, database, "admin", true)
		require.NoError(t, goose.UpTo(database, dir, 16))
	})
}

// assertMetadataPermission checks migration ownership without inferring it from application defaults.
func assertMetadataPermission(t *testing.T, database *sql.DB, key string, want bool) {
	t.Helper()
	var got bool
	require.NoError(t, database.QueryRowContext(t.Context(), `select permissions ? 'short_link:set_metadata' from user_group where key=$1`, key).Scan(&got))
	require.Equal(t, want, got, key)
}
