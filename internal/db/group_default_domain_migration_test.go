package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// Catches missing persistence, invalid group/domain references and destructive default rollback.
func TestGroupDefaultDomainMigrationRoundTrip(t *testing.T) {
	for _, populated := range []bool{false, true} {
		name := "empty"
		if populated {
			name = "existing_data"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 26))
			var before string
			const snapshot = `select jsonb_agg(jsonb_build_array(key,permissions,updated_at) order by key)::text from user_group`
			if populated {
				insertUserGroups(t, ctx, database)
				require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&before))
			}
			require.NoError(t, goose.Up(database, dir))
			var configured int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_group where default_domain_id is not null`).Scan(&configured))
			require.Zero(t, configured)
			if populated {
				var after string
				require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&after))
				require.Equal(t, before, after, "upgrade must not rewrite existing permissions or revision")
			} else {
				insertUserGroups(t, ctx, database)
			}
			_, err := database.ExecContext(ctx, `
				insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
				('00000000-0000-0000-0000-000000000102','https://group.example.com','Group','short_link',true,false,now(),now()),
				('00000000-0000-0000-0000-000000000000','https://zero.example.com','Zero','short_link',false,false,now(),now());
				insert into user_preference(user_id,language,theme) values('00000000-0000-0000-0000-000000000201','en','dark');
				insert into user_domain_preference(user_id,domain_id) values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101');
				insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
				values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',
				'00000000-0000-0000-0000-000000000101','keepgroup28','https://example.com/keep','active',now(),now())`)
			require.NoError(t, err)
			for _, invalid := range []struct{ query, code string }{
				{`update user_group set default_domain_id='00000000-0000-0000-0000-000000000101' where key='guest'`, "23514"},
				{`update user_group set default_domain_id='00000000-0000-0000-0000-000000000000' where key='user'`, "23514"},
				{`update user_group set builtin=false,default_domain_id='00000000-0000-0000-0000-000000000101' where key='user'`, "23514"},
				{`update user_group set default_domain_id='00000000-0000-0000-0000-000000000199' where key='user'`, "23503"},
				{`insert into user_group(id,key,name,permissions,builtin,created_at,updated_at,default_domain_id) values(gen_random_uuid(),'team','Team','[]',true,now(),now(),'00000000-0000-0000-0000-000000000101')`, "23514"},
			} {
				_, err := database.ExecContext(ctx, invalid.query)
				var pgErr *pgconn.PgError
				require.True(t, errors.As(err, &pgErr), "expected SQLSTATE %s, got %v", invalid.code, err)
				require.Equal(t, invalid.code, pgErr.Code)
			}
			tx, err := database.BeginTx(ctx, nil)
			require.NoError(t, err)
			t.Cleanup(func() { _ = tx.Rollback() })
			_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true)`)
			require.NoError(t, err)
			_, err = tx.ExecContext(ctx, `update user_group set default_domain_id='00000000-0000-0000-0000-000000000102' where key in ('user','admin')`)
			require.NoError(t, err)
			// A repeated value must not create a second default audit.
			_, err = tx.ExecContext(ctx, `update user_group set default_domain_id=default_domain_id where key='user'`)
			require.NoError(t, err)
			_, err = tx.ExecContext(ctx, `update user_group set permissions='["short_link:create"]' where key='user'`)
			require.NoError(t, err)
			require.NoError(t, tx.Commit())
			var defaults, permissions int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) filter(where action='update' and changed_fields=array['default_domain_id']),
				count(*) filter(where action='permissions_change' and changed_fields=array['permissions']) from audit_log where resource_type='user_group'`).Scan(&defaults, &permissions))
			require.Equal(t, 2, defaults)
			require.Equal(t, 1, permissions)
			_, err = database.ExecContext(ctx, `delete from domain where id='00000000-0000-0000-0000-000000000102'`)
			var fkError *pgconn.PgError
			require.True(t, errors.As(err, &fkError))
			require.Equal(t, "23503", fkError.Code, "an old application cannot delete a referenced group default")
			var savedGroups string
			require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&savedGroups))
			require.NoError(t, goose.DownTo(database, dir, 26))
			var hasColumn bool
			require.NoError(t, database.QueryRowContext(ctx, `select exists(select 1 from information_schema.columns where table_name='user_group' and column_name='default_domain_id')`).Scan(&hasColumn))
			require.False(t, hasColumn)
			var afterDown string
			require.NoError(t, database.QueryRowContext(ctx, snapshot).Scan(&afterDown))
			require.Equal(t, savedGroups, afterDown)
			var retained int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&retained))
			require.Equal(t, 3, retained)
			var legacy bool
			require.NoError(t, database.QueryRowContext(ctx, `select p.language='en' and p.theme='dark' and dp.domain_id=d.id and l.slug='keepgroup28'
				from user_preference p join user_domain_preference dp using(user_id) join domain d on d.id=dp.domain_id
				join short_link l on l.owner_id=p.user_id where p.user_id='00000000-0000-0000-0000-000000000201'`).Scan(&legacy))
			require.True(t, legacy)
			require.NoError(t, goose.Up(database, dir))
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from user_group where default_domain_id is not null`).Scan(&configured))
			require.Zero(t, configured, "reapply must not recreate discarded settings")
		})
	}
}
