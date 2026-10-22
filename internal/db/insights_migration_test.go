package db_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestInsightsMigrationRoundTrip checks per-permission ownership and preserves existing event history.
func TestInsightsMigrationRoundTrip(t *testing.T) {
	keys := []string{"short_link:read_visits", "statistics:read_all", "audit:read"}
	for _, edited := range []string{"", "short_link:read_visits", "statistics:read_all", "audit:read"} {
		t.Run("independent edit "+edited, func(t *testing.T) {
			database := migrationTestDatabase(t, t.Context())
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 19))
			insertUserGroups(t, t.Context(), database)
			_, err := database.ExecContext(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','insight','https://example.com','active',now(),now()); insert into short_link_event(id,short_link_id,event_type,created_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000000301','redirect_response_sent',now())`)
			require.NoError(t, err)
			require.NoError(t, goose.UpTo(database, dir, 20))
			for _, key := range keys {
				assertInsightGrant(t, database, "admin", key, true)
				assertInsightGrant(t, database, "user", key, key == "short_link:read_visits")
				assertInsightGrant(t, database, "guest", key, false)
			}
			var missing bool
			require.NoError(t, database.QueryRowContext(t.Context(), `select browser_family is null and os_family is null from short_link_event`).Scan(&missing))
			require.True(t, missing)
			_, err = database.ExecContext(t.Context(), `update short_link_event set browser_family='chrome',os_family='windows'`)
			require.NoError(t, err)
			_, err = database.ExecContext(t.Context(), `update short_link_event set browser_family='private UA/1.0'`)
			require.Error(t, err)
			_, err = database.ExecContext(t.Context(), `update short_link_event set os_family='private OS/1.0'`)
			require.Error(t, err)
			if edited != "" {
				_, err = database.ExecContext(t.Context(), `update user_group set permissions=permissions-$1 where key='admin'`, edited)
				require.NoError(t, err)
				_, err = database.ExecContext(t.Context(), `update user_group set permissions=permissions || jsonb_build_array($1::text) where key='admin'`, edited)
				require.NoError(t, err)
			}
			_, err = database.ExecContext(t.Context(), `update user_group set permissions=permissions || '["future:grant"]'::jsonb,name='Renamed' where key='admin'`)
			require.NoError(t, err)
			require.NoError(t, goose.DownTo(database, dir, 19))
			for _, key := range keys {
				assertInsightGrant(t, database, "admin", key, key == edited)
				assertInsightGrant(t, database, "user", key, false)
			}
			assertInsightGrant(t, database, "admin", "future:grant", true)
			var count int
			require.NoError(t, database.QueryRowContext(t.Context(), `select count(*) from short_link_event`).Scan(&count))
			require.Equal(t, 1, count)
			require.NoError(t, goose.UpTo(database, dir, 20))
			for _, key := range keys {
				assertInsightGrant(t, database, "admin", key, true)
			}
		})
	}
	for _, mode := range []string{"preexisting", "after migration", "nonbuiltin"} {
		t.Run(mode, func(t *testing.T) {
			database := migrationTestDatabase(t, t.Context())
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 19))
			if mode != "after migration" {
				insertUserGroups(t, t.Context(), database)
			}
			if mode == "nonbuiltin" {
				_, err := database.ExecContext(t.Context(), `update user_group set builtin=false where key in ('user','admin')`)
				require.NoError(t, err)
			}
			grant := func() {
				_, err := database.ExecContext(t.Context(), `update user_group set permissions=permissions || '["short_link:read_visits","statistics:read_all","audit:read"]'::jsonb where key='admin'`)
				require.NoError(t, err)
			}
			if mode == "preexisting" {
				grant()
			}
			require.NoError(t, goose.UpTo(database, dir, 20))
			if mode == "after migration" {
				insertUserGroups(t, t.Context(), database)
				grant()
			}
			require.NoError(t, goose.DownTo(database, dir, 19))
			for _, key := range keys {
				assertInsightGrant(t, database, "admin", key, mode != "nonbuiltin")
			}
		})
	}
}

// assertInsightGrant reads actual database grants independently of application defaults.
func assertInsightGrant(t *testing.T, database *sql.DB, group, key string, want bool) {
	t.Helper()
	var got bool
	require.NoError(t, database.QueryRowContext(t.Context(), `select permissions ? $1 from user_group where key=$2`, key, group).Scan(&got))
	require.Equal(t, want, got, group+" "+key)
}
