package db_test

import (
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

// TestDomainOrderMigrationRoundTrip catches missing defaults, weak constraints,
// lost business data, and an audit trigger left referencing a removed column.
func TestDomainOrderMigrationRoundTrip(t *testing.T) {
	for _, populated := range []bool{false, true} {
		name := "empty"
		if populated {
			name = "existing_data"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			if err := goose.UpTo(database, dir, 25); err != nil {
				t.Fatal(err)
			}
			seed := func() {
				insertUserGroups(t, ctx, database)
				if _, err := database.ExecContext(ctx, `
					insert into domain_user_group(domain_id,user_group_id) values
					('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000002');
					insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
					values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',
					'00000000-0000-0000-0000-000000000101','keeporder27','https://example.com/keep','active',now(),now());
					insert into user_domain_preference(user_id,domain_id,updated_at)
					values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','2026-10-27T01:02:03.123456Z');
					insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields)
					values(null,'domain','historical','update',array['display_name'])
				`); err != nil {
					t.Fatalf("seed preserved resources: %v", err)
				}
			}
			snapshot := func() string {
				var value string
				if err := database.QueryRowContext(ctx, `
					select jsonb_build_object(
					'domain',jsonb_build_array(d.id,d.host,d.display_name,d.enabled,d.is_default,d.created_at,d.updated_at),
					'link',row_to_json(l),'preference',row_to_json(p),'user',row_to_json(u),'grant',row_to_json(g))::text
					from domain d join short_link l on l.domain_id=d.id
					join user_domain_preference p on p.domain_id=d.id
					join app_user u on u.id=p.user_id join domain_user_group g on g.domain_id=d.id
				`).Scan(&value); err != nil {
					t.Fatalf("read preserved resources: %v", err)
				}
				return value
			}
			before := ""
			if populated {
				seed()
				before = snapshot()
			}
			if err := goose.Up(database, dir); err != nil {
				t.Fatal(err)
			}
			var order int32
			if err := database.QueryRowContext(ctx, `select coalesce((select sort_order from domain limit 1),0)`).Scan(&order); err != nil || order != 0 {
				t.Fatalf("domain order must exist and default to zero: got %d err=%v", order, err)
			}
			if !populated {
				seed()
				before = snapshot()
			}
			if got := snapshot(); got != before {
				t.Fatal("upgrade changed pre-existing resources")
			}
			for _, invalid := range []struct{ value, code string }{
				{"null", "23502"}, {"-10001", "23514"}, {"10001", "23514"},
			} {
				_, err := database.ExecContext(ctx, `update domain set sort_order=`+invalid.value)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != invalid.code {
					t.Fatalf("order constraint %s: got %v want SQLSTATE %s", invalid.value, err, invalid.code)
				}
			}
			for _, boundary := range []int32{-10000, 10000} {
				if _, err := database.ExecContext(ctx, `update domain set sort_order=$1`, boundary); err != nil {
					t.Fatalf("legal order boundary %d: %v", boundary, err)
				}
			}
			auditedWrite := func(query string) {
				tx, err := database.BeginTx(ctx, nil)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { _ = tx.Rollback() }()
				if _, err := tx.ExecContext(ctx, `select set_config('moeurl.audit_enabled','on',true), set_config('moeurl.audit_actor','00000000-0000-0000-0000-000000000201',true)`); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.ExecContext(ctx, query); err != nil {
					t.Fatalf("audited domain write: %v", err)
				}
				if err := tx.Commit(); err != nil {
					t.Fatal(err)
				}
			}
			auditedWrite(`update domain set sort_order=-20`)
			var fields string
			if err := database.QueryRowContext(ctx, `select array_to_json(changed_fields)::text from audit_log order by id desc limit 1`).Scan(&fields); err != nil || fields != `["sort_order"]` {
				t.Fatalf("sort audit should contain only field name: %s %v", fields, err)
			}
			if err := goose.DownTo(database, dir, 25); err != nil {
				t.Fatal(err)
			}
			var columnName string
			if err := database.QueryRowContext(ctx, `select column_name from information_schema.columns where table_schema='public' and table_name='domain' and column_name='sort_order'`).Scan(&columnName); !errors.Is(err, sql.ErrNoRows) {
				t.Fatalf("rollback must remove only new order column: %q %v", columnName, err)
			}
			if got := snapshot(); got != before {
				t.Fatal("rollback changed pre-existing resources")
			}
			auditedWrite(`update domain set display_name='After rollback'`)
			if err := database.QueryRowContext(ctx, `select array_to_json(changed_fields)::text from audit_log order by id desc limit 1`).Scan(&fields); err != nil || fields != `["display_name"]` {
				t.Fatalf("old audit trigger must still work: %s %v", fields, err)
			}
			before = snapshot()
			if err := goose.Up(database, dir); err != nil {
				t.Fatal(err)
			}
			var historyCount int
			if err := database.QueryRowContext(ctx, `select count(*) from audit_log`).Scan(&historyCount); err != nil || historyCount != 3 {
				t.Fatalf("historical audits lost: %d %v", historyCount, err)
			}
			if err := database.QueryRowContext(ctx, `select sort_order from domain`).Scan(&order); err != nil || order != 0 || snapshot() != before {
				t.Fatalf("reapply must default only order and preserve data: %d %v", order, err)
			}
		})
	}
}
