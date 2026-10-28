package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
	"github.com/stretchr/testify/require"
)

// TestDomainRedirectDefaultMigrationRoundTrip catches missing defaults, weak
// constraints, lost data and a rollback trigger referencing a removed column.
func TestDomainRedirectDefaultMigrationRoundTrip(t *testing.T) {
	for _, populated := range []bool{false, true} {
		name := "empty"
		if populated {
			name = "existing_data"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			require.NoError(t, goose.UpTo(database, dir, 27))
			seed := func() {
				insertUserGroups(t, ctx, database)
				_, err := database.ExecContext(ctx, `
                    insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
                    values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',
                    '00000000-0000-0000-0000-000000000101','keepmode29','https://example.com/keep','active',now(),now());
                    insert into user_domain_preference(user_id,domain_id,updated_at)
                    values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','2026-10-28T01:02:03.123456Z');
                    update user_group set default_domain_id='00000000-0000-0000-0000-000000000101' where key='user';
                    insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
                    values(null,'domain','historical','update',array['display_name'])`)
				require.NoError(t, err)
			}
			snapshot := func() string {
				var value string
				require.NoError(t, database.QueryRowContext(ctx, `
                    select jsonb_build_object(
                    'domain',jsonb_build_array(d.id,d.host,d.display_name,d.purpose,d.enabled,d.is_default,d.sort_order,d.created_at,d.updated_at),
                    'link',row_to_json(l),'preference',row_to_json(p),'user',row_to_json(u),
                    'groups',(select jsonb_agg(to_jsonb(g) order by g.key) from user_group g))::text
                    from domain d join short_link l on l.domain_id=d.id
                    join user_domain_preference p on p.domain_id=d.id
                    join app_user u on u.id=p.user_id`).Scan(&value))
				return value
			}
			before := ""
			if populated {
				seed()
				before = snapshot()
			}
			require.NoError(t, goose.Up(database, dir))
			if !populated {
				seed()
				before = snapshot()
			}
			var mode string
			require.NoError(t, database.QueryRowContext(ctx, `select default_redirect_mode from domain`).Scan(&mode))
			require.Equal(t, "direct", mode, "existing and newly inserted domains must retain the old default")
			require.Equal(t, before, snapshot(), "upgrade must not rewrite old resources or their revisions")
			for _, invalid := range []struct {
				value any
				code  string
			}{
				{nil, "23502"}, {"bogus", "23514"}, {"Confirmation", "23514"}, {"", "23514"},
			} {
				_, err := database.ExecContext(ctx, `update domain set default_redirect_mode=$1`, invalid.value)
				var pgErr *pgconn.PgError
				require.True(t, errors.As(err, &pgErr), "invalid mode must fail in PostgreSQL: %v", err)
				require.Equal(t, invalid.code, pgErr.Code)
			}
			for _, valid := range []string{"direct", "intermediate", "confirmation"} {
				_, err := database.ExecContext(ctx, `update domain set default_redirect_mode=$1`, valid)
				require.NoError(t, err)
			}
			auditedWrite := func(query string) {
				tx, err := database.BeginTx(ctx, nil)
				require.NoError(t, err)
				defer func() { _ = tx.Rollback() }()
				_, err = tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true),
                    set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true)`)
				require.NoError(t, err)
				_, err = tx.ExecContext(ctx, query)
				require.NoError(t, err)
				require.NoError(t, tx.Commit())
			}
			auditedWrite(`update domain set default_redirect_mode='intermediate'`)
			var fields string
			require.NoError(t, database.QueryRowContext(ctx, `select array_to_json(changed_fields)::text from audit_log order by id desc limit 1`).Scan(&fields))
			require.Equal(t, `["default_redirect_mode"]`, fields, "audit stores the changed field name, not its value")
			require.Equal(t, before, snapshot())
			require.NoError(t, goose.DownTo(database, dir, 27))
			var columns int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from information_schema.columns
                where table_schema='public' and table_name='domain' and column_name='default_redirect_mode'`).Scan(&columns))
			require.Zero(t, columns)
			require.Equal(t, before, snapshot(), "rollback must remove only the new setting")
			auditedWrite(`update domain set display_name='After mode rollback'`)
			require.NoError(t, database.QueryRowContext(ctx, `select array_to_json(changed_fields)::text from audit_log order by id desc limit 1`).Scan(&fields))
			require.Equal(t, `["display_name"]`, fields, "the restored legacy trigger must remain usable")
			before = snapshot()
			require.NoError(t, goose.Up(database, dir))
			require.NoError(t, database.QueryRowContext(ctx, `select default_redirect_mode from domain`).Scan(&mode))
			require.Equal(t, "direct", mode, "reapply starts direct, not the discarded old configuration")
			require.Equal(t, before, snapshot())
			var history int
			require.NoError(t, database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&history))
			require.Equal(t, 3, history, "old and new audit field histories must survive")
		})
	}
}
