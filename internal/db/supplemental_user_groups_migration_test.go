package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

func TestSupplementalUserGroupsMigrationRollbackGuard(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 50))
	insertUserGroups(t, ctx, database)
	require.NoError(t, goose.UpTo(database, dir, 51))
	require.NoError(t, goose.DownTo(database, dir, 50), "an empty supplemental relation table must be rollback-safe")
	var emptyRelationExists bool
	require.NoError(t, database.QueryRowContext(ctx, `select to_regclass('app_user_group_membership') is not null`).Scan(&emptyRelationExists))
	require.False(t, emptyRelationExists)
	require.NoError(t, goose.UpTo(database, dir, 51), "an empty rollback must be safely repeatable")

	const userID = "00000000-0000-0000-0000-000000000201"
	const groupID = "00000000-0000-0000-0000-000000000901"
	_, err := database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at)
		values ($1,'550e8400-e29b-41d4-a716-446655440090','Supplemental','', '[]'::jsonb,false,now(),now())
	`, groupID)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `
		insert into app_user_group_membership (user_id,user_group_id) values ($1,$2)
	`, userID, groupID)
	require.NoError(t, err)

	err = goose.DownTo(database, dir, 50)
	require.ErrorContains(t, err, "supplemental user group memberships exist")
	var membershipCount int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from app_user_group_membership`).Scan(&membershipCount))
	require.Equal(t, 1, membershipCount, "a guarded rollback must preserve membership rows")
	version, err := goose.GetDBVersion(database)
	require.NoError(t, err)
	require.EqualValues(t, 51, version, "a failed rollback must not advance the goose version")

	_, err = database.ExecContext(ctx, `delete from app_user_group_membership where user_id=$1 and user_group_id=$2`, userID, groupID)
	require.NoError(t, err)
	require.NoError(t, goose.DownTo(database, dir, 50))
	require.NoError(t, goose.UpTo(database, dir, 51), "the migration must be retryable after membership data is explicitly removed")
	var relationExists bool
	require.NoError(t, database.QueryRowContext(ctx, `select to_regclass('app_user_group_membership') is not null`).Scan(&relationExists))
	require.True(t, relationExists)

	_, err = database.ExecContext(ctx, `insert into app_user_group_membership (user_id,user_group_id) values ($1,$2)`, userID, groupID)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `insert into app_user_group_membership (user_id,user_group_id) values ($1,$2)`, userID, groupID)
	require.Error(t, err, "the compound primary key must reject duplicate account/group relations")
	_, err = database.ExecContext(ctx, `delete from app_user where id=$1`, userID)
	require.NoError(t, err)
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from app_user_group_membership`).Scan(&membershipCount))
	require.Zero(t, membershipCount, "deleting an account must cascade its supplemental relations")
}
