package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// Down deliberately discards only this preference, both unused and populated.
func TestListPreferenceMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 36))
	insertUserGroups(t, ctx, database)
	const snapshot = `select jsonb_build_object(
		'users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u where username='alice'),
		'links',(select jsonb_agg(to_jsonb(l) order by id) from short_link l),
		'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),
		'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),
		'timezone',(select jsonb_agg(to_jsonb(p) order by user_id) from user_time_zone_preference p),
		'redirect',(select jsonb_agg(to_jsonb(p) order by user_id) from user_redirect_preference p))::text`
	var before, after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
	require.NoError(t, goose.Up(database, dir))
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_list_preference`).Scan(&count))
	require.Zero(t, count)
	require.NoError(t, goose.DownTo(database, dir, 36))
	assertRelationExists(t, ctx, database, "user_list_preference", false)
	require.NoError(t, goose.Up(database, dir))
	_, err := database.ExecContext(ctx, `insert into user_list_preference(user_id,page_size) values
		('00000000-0000-0000-0000-000000000201',50),('00000000-0000-0000-0000-000000000202',null)`)
	require.NoError(t, err)
	for _, size := range []any{nil, 20, 50, 100} {
		_, err := database.ExecContext(ctx, `update user_list_preference set page_size=$1 where user_id='00000000-0000-0000-0000-000000000201'`, size)
		require.NoError(t, err)
	}
	for _, tc := range []struct{ sql, code string }{
		{`update user_list_preference set page_size=0`, "23514"},
		{`update user_list_preference set page_size=21`, "23514"},
		{`update user_list_preference set page_size=101`, "23514"},
		{`update user_list_preference set updated_at=null`, "23502"},
		{`insert into user_list_preference(user_id) values('00000000-0000-0000-0000-000000000201')`, "23505"},
		{`insert into user_list_preference(user_id) values('00000000-0000-0000-0000-000000000299')`, "23503"},
	} {
		_, err := database.ExecContext(ctx, tc.sql)
		var pgErr *pgconn.PgError
		require.True(t, errors.As(err, &pgErr), tc.sql)
		require.Equal(t, tc.code, pgErr.Code)
	}
	_, err = database.ExecContext(ctx, `delete from app_user where username='bob'`)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_list_preference`).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, goose.DownTo(database, dir, 36))
	assertRelationExists(t, ctx, database, "user_list_preference", false)
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)
	require.NoError(t, goose.Up(database, dir))
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_list_preference`).Scan(&count))
	require.Zero(t, count)
}
