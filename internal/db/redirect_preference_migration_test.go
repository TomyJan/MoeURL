package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestRedirectPreferenceMigration catches missing constraints, unwanted backfill,
// collateral rollback data loss and a misleading claim that Down preserves personal values.
func TestRedirectPreferenceMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 33))
	insertUserGroups(t, ctx, database)
	_, err := database.ExecContext(ctx, `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		values('00000000-0000-0000-0000-000000000391','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','redirectold','https://example.com/original','active',now(),now())`)
	require.NoError(t, err)
	const snapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u where username='alice'),
		'links',(select jsonb_agg(to_jsonb(l) order by id) from short_link l),
		'interface',(select jsonb_agg(to_jsonb(p)) from user_preference p),
		'domain',(select jsonb_agg(to_jsonb(p)) from user_domain_preference p),
		'timezone',(select jsonb_agg(to_jsonb(p)) from user_time_zone_preference p))::text`
	var before, after string
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
	require.NoError(t, goose.Up(database, dir))
	var count int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_redirect_preference`).Scan(&count))
	require.Zero(t, count)
	_, err = database.ExecContext(ctx, `insert into user_redirect_preference(user_id,redirect_mode) values
		('00000000-0000-0000-0000-000000000201','confirmation'),('00000000-0000-0000-0000-000000000202',null)`)
	require.NoError(t, err)
	for _, mode := range []any{nil, "direct", "intermediate", "confirmation"} {
		_, err := database.ExecContext(ctx, `update user_redirect_preference set redirect_mode=$1 where user_id='00000000-0000-0000-0000-000000000201'`, mode)
		require.NoError(t, err)
	}
	for _, tc := range []struct{ sql, code string }{
		{`update user_redirect_preference set redirect_mode='DIRECT'`, "23514"},
		{`update user_redirect_preference set redirect_mode=''`, "23514"},
		{`update user_redirect_preference set redirect_mode=' direct'`, "23514"},
		{`update user_redirect_preference set updated_at=null`, "23502"},
		{`insert into user_redirect_preference(user_id) values('00000000-0000-0000-0000-000000000201')`, "23505"},
		{`insert into user_redirect_preference(user_id) values('00000000-0000-0000-0000-000000000299')`, "23503"},
	} {
		_, err := database.ExecContext(ctx, tc.sql)
		var pgErr *pgconn.PgError
		require.True(t, errors.As(err, &pgErr), tc.sql)
		require.Equal(t, tc.code, pgErr.Code)
	}
	_, err = database.ExecContext(ctx, `delete from app_user where username='bob'`)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_redirect_preference`).Scan(&count))
	require.Equal(t, 1, count)
	require.NoError(t, goose.DownTo(database, dir, 33))
	assertRelationExists(t, ctx, database, "user_redirect_preference", false)
	require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
	require.Equal(t, before, after)
	require.NoError(t, goose.Up(database, dir))
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_redirect_preference`).Scan(&count))
	require.Zero(t, count)
}
