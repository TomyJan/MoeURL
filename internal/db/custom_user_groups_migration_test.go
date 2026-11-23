package db_test

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

func TestCustomUserGroupMigrationRoundTrip(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 49))
	insertUserGroups(t, ctx, database)
	require.NoError(t, goose.UpTo(database, dir, 50))

	const groupID = "00000000-0000-0000-0000-000000000901"
	_, err := database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at)
		values ($1,'550e8400-e29b-41d4-a716-446655440000','  Growth Team  ','campaign operators','[]'::jsonb,false,now(),now())
	`, groupID)
	require.NoError(t, err, "custom groups must use stable opaque keys and empty permissions")

	_, err = database.ExecContext(ctx, `update user_group set default_domain_id='00000000-0000-0000-0000-000000000101' where id=$1`, groupID)
	require.NoError(t, err, "custom groups may store a domain default; authorization is checked by the service")

	_, err = database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at)
		values ('00000000-0000-0000-0000-000000000902','550e8400-e29b-41d4-a716-446655440001','growth team','duplicate name','[]'::jsonb,false,now(),now())
	`)
	var duplicate *pgconn.PgError
	require.Error(t, err)
	require.True(t, errors.As(err, &duplicate))
	require.Equal(t, "23505", duplicate.Code, "trimmed, case-insensitive group names are unique")

	_, err = database.ExecContext(ctx, `
		insert into domain_user_group (domain_id,user_group_id)
		values ('00000000-0000-0000-0000-000000000101',$1)
	`, groupID)
	require.NoError(t, err)

	_, err = database.ExecContext(ctx, `
		insert into app_user (id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		values ('00000000-0000-0000-0000-000000000204','growth-member','hash','Growth Member',$1,'active',false,now(),now())
	`, groupID)
	require.NoError(t, err, "custom groups may own regular accounts")

	_, err = database.ExecContext(ctx, `delete from user_group where id=$1`, groupID)
	var referenced *pgconn.PgError
	require.Error(t, err, "a group referenced by any account cannot be deleted")
	require.True(t, errors.As(err, &referenced))
	require.Equal(t, "23503", referenced.Code)

	_, err = database.ExecContext(ctx, `delete from app_user where username='alice'`)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `delete from app_user where username='bob'`)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `update app_user set deleted_at=now() where username='growth-member'`)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `delete from user_group where id=$1`, groupID)
	require.Error(t, err, "soft-deleted accounts still retain the group foreign key")
	_, err = database.ExecContext(ctx, `delete from app_user where username='growth-member'`)
	require.NoError(t, err)
	_, err = database.ExecContext(ctx, `delete from user_group where id=$1`, groupID)
	require.NoError(t, err)
	var grants int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from domain_user_group where user_group_id=$1`, groupID).Scan(&grants))
	require.Zero(t, grants, "deleting a custom group must not leave domain grants")
}

func TestCustomUserGroupMigrationTrimsUnicodeWhitespaceConsistently(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 49))
	insertUserGroups(t, ctx, database)

	_, err := database.ExecContext(ctx, `
		update user_group
		set name = case key when 'user' then $1 when 'admin' then 'Ops' end
		where key in ('user', 'admin')
	`, "\tOps\t")
	require.NoError(t, err)
	err = goose.UpTo(database, dir, 50)
	require.ErrorContains(t, err, "names are not unique")

	_, err = database.ExecContext(ctx, `update user_group set name = case key when 'user' then 'User' when 'admin' then 'Admin' end where key in ('user', 'admin')`)
	require.NoError(t, err)
	require.NoError(t, goose.UpTo(database, dir, 50), "migration should be retryable after conflicting legacy names are repaired")

	const boundaryKey = "550e8400-e29b-41d4-a716-446655440010"
	boundaryName := "\t" + strings.Repeat("G", 64) + "\t"
	_, err = database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at)
		values ('00000000-0000-0000-0000-000000000910',$1,$2,'','[]'::jsonb,false,now(),now())
	`, boundaryKey, boundaryName)
	require.NoError(t, err, "tabs are trimmed before enforcing the 64-rune name limit")
	_, err = database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at)
		values ('00000000-0000-0000-0000-000000000911','550e8400-e29b-41d4-a716-446655440011',$1,'','[]'::jsonb,false,now(),now())
	`, strings.Repeat("g", 64))
	var duplicate *pgconn.PgError
	require.Error(t, err)
	require.True(t, errors.As(err, &duplicate))
	require.Equal(t, "23505", duplicate.Code, "the unique index must use the same trimmed key as Go")
}

func TestCustomUserGroupMigrationDownPreservesCustomData(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 49))
	insertUserGroups(t, ctx, database)
	require.NoError(t, goose.UpTo(database, dir, 50))

	const groupID = "00000000-0000-0000-0000-000000000903"
	_, err := database.ExecContext(ctx, `
		insert into user_group (id,key,name,description,permissions,builtin,created_at,updated_at,default_domain_id)
		values ($1,'550e8400-e29b-41d4-a716-446655440002','Ops','operator access','[]'::jsonb,false,now(),now(),'00000000-0000-0000-0000-000000000101')
	`, groupID)
	require.NoError(t, err)

	err = goose.DownTo(database, dir, 49)
	require.ErrorContains(t, err, "custom user groups exist")
	var groups int
	require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_group where id=$1`, groupID).Scan(&groups))
	require.Equal(t, 1, groups, "a guarded rollback must retain custom group data")

	_, err = database.ExecContext(ctx, `delete from user_group where id=$1`, groupID)
	require.NoError(t, err)
	require.NoError(t, goose.DownTo(database, dir, 49))
	require.NoError(t, goose.UpTo(database, dir, 50))
	var column bool
	require.NoError(t, database.QueryRowContext(ctx, `select exists(select 1 from information_schema.columns where table_name='user_group' and column_name='default_domain_id')`).Scan(&column))
	require.True(t, column, "migration must be safely repeatable after a guarded rollback is resolved")
}

func TestCustomUserGroupSQLCQueries(t *testing.T) {
	ctx := t.Context()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	insertBuiltinUserGroupFixtures(t, ctx, pool)
	groupID := uuid.New()
	groupKey := groupID.String()

	group, err := queries.CreateCustomUserGroup(ctx, sqlc.CreateCustomUserGroupParams{
		ID:          uuidToPgtype(groupID),
		GroupKey:    groupKey,
		Name:        "Operations",
		Description: "Operations team",
	})
	require.NoError(t, err)
	require.False(t, group.Builtin)
	require.Equal(t, groupKey, group.Key)
	require.JSONEq(t, `[]`, string(group.Permissions))

	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	_, err = pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values($1,'go.example.com','Default','short_link',true,true,now(),now())`, uuidToPgtype(domainID))
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) values($1,$2)`, uuidToPgtype(domainID), uuidToPgtype(groupID))
	require.NoError(t, err)

	createdUserID := uuid.New()
	_, err = pool.Exec(ctx, `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		values($1,'ops-member','hash','Ops Member',$2,'active',false,now(),now())`, uuidToPgtype(createdUserID), uuidToPgtype(groupID))
	require.NoError(t, err)

	groups, err := queries.ListUserGroups(ctx)
	require.NoError(t, err)
	var listed bool
	for _, candidate := range groups {
		if candidate.Key == groupKey {
			listed = true
			require.EqualValues(t, 1, candidate.MemberCount)
		}
	}
	require.True(t, listed)

	updated, err := queries.UpdateCustomUserGroupDetails(ctx, sqlc.UpdateCustomUserGroupDetailsParams{
		GroupKey: groupKey, Name: "Operations New", Description: "Operators", ExpectedUpdatedAt: group.UpdatedAt,
	})
	require.NoError(t, err)
	_, err = queries.UpdateCustomUserGroupDetails(ctx, sqlc.UpdateCustomUserGroupDetailsParams{
		GroupKey: groupKey, Name: "Stale", Description: "Old revision", ExpectedUpdatedAt: group.UpdatedAt,
	})
	require.ErrorIs(t, err, pgx.ErrNoRows)

	updated, err = queries.UpdateCustomUserGroupPermissions(ctx, sqlc.UpdateCustomUserGroupPermissionsParams{
		GroupKey: groupKey, Permissions: []byte(`["short_link:create"]`), ExpectedUpdatedAt: updated.UpdatedAt,
	})
	require.NoError(t, err)
	require.JSONEq(t, `["short_link:create"]`, string(updated.Permissions))

	_, err = queries.DeleteCustomUserGroup(ctx, groupKey)
	require.ErrorIs(t, err, pgx.ErrNoRows, "active members prevent group deletion")
	_, err = pool.Exec(ctx, `delete from app_user where id=$1`, uuidToPgtype(createdUserID))
	require.NoError(t, err)
	_, err = queries.DeleteCustomUserGroup(ctx, groupKey)
	require.NoError(t, err)
	var grants int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from domain_user_group where user_group_id=$1`, uuidToPgtype(groupID)).Scan(&grants))
	require.Zero(t, grants)
}

func TestCustomUserGroupMigrationAuditsLifecycleWithoutValues(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	require.NoError(t, goose.UpTo(database, dir, 49))
	insertUserGroups(t, ctx, database)
	require.NoError(t, goose.UpTo(database, dir, 50))

	const groupID = "00000000-0000-0000-0000-000000000904"
	actorID := "00000000-0000-0000-0000-000000000201"
	tx, err := database.BeginTx(ctx, nil)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor',$1,true)`, actorID)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values($1,'550e8400-e29b-41d4-a716-446655440004','Operations','Ops team','[]'::jsonb,false,now(),now())`, groupID)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `update user_group set name='Operations Team',description='Platform operators' where id=$1`, groupID)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())

	var action string
	var fieldsJSON string
	require.NoError(t, database.QueryRowContext(ctx, `select action,array_to_json(changed_fields)::text from audit_log where resource_type='user_group' and resource_id=$1 order by id limit 1`, groupID).Scan(&action, &fieldsJSON))
	require.Equal(t, "create", action)
	require.JSONEq(t, `["name","description","permissions"]`, fieldsJSON)
	require.NoError(t, database.QueryRowContext(ctx, `select action,array_to_json(changed_fields)::text from audit_log where resource_type='user_group' and resource_id=$1 order by id desc limit 1`, groupID).Scan(&action, &fieldsJSON))
	require.Equal(t, "update", action)
	require.JSONEq(t, `["name","description"]`, fieldsJSON)

	tx, err = database.BeginTx(ctx, nil)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor',$1,true)`, actorID)
	require.NoError(t, err)
	_, err = tx.ExecContext(ctx, `delete from user_group where id=$1`, groupID)
	require.NoError(t, err)
	require.NoError(t, tx.Commit())
	require.NoError(t, database.QueryRowContext(ctx, `select action,array_to_json(changed_fields)::text from audit_log where resource_type='user_group' and resource_id=$1 order by id desc limit 1`, groupID).Scan(&action, &fieldsJSON))
	require.Equal(t, "delete", action)
	require.JSONEq(t, `["name","description","permissions","default_domain_id"]`, fieldsJSON)
}

func insertBuiltinUserGroupFixtures(t *testing.T, ctx context.Context, pool interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}) {
	t.Helper()
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at) values
		('00000000-0000-0000-0000-000000000001','guest','Guest','','[]'::jsonb,true,now(),now()),
		('00000000-0000-0000-0000-000000000002','user','User','','[]'::jsonb,true,now(),now()),
		('00000000-0000-0000-0000-000000000003','admin','Admin','','[]'::jsonb,true,now(),now())`)
	require.NoError(t, err)
}
