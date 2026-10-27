package db_test

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

// TestUserDomainPreferenceMigrationRoundTrip catches missing persistence, broken references,
// and destructive rollback of the account, interface preferences, domain or short link.
func TestUserDomainPreferenceMigrationRoundTrip(t *testing.T) {
	for _, populated := range []bool{false, true} {
		name := "empty"
		if populated {
			name = "existing_data"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			database := migrationTestDatabase(t, ctx)
			dir := filepath.Join("..", "..", "migrations")
			if err := goose.UpTo(database, dir, 24); err != nil {
				t.Fatal(err)
			}
			if populated {
				insertUserGroups(t, ctx, database)
			}
			if err := goose.Up(database, dir); err != nil {
				t.Fatal(err)
			}
			assertRelationExists(t, ctx, database, "user_domain_preference", true)
			var count int
			if err := database.QueryRowContext(ctx, `select count(*) from user_domain_preference`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("new preferences should not be backfilled: count=%d err=%v", count, err)
			}
			if !populated {
				insertUserGroups(t, ctx, database)
			}
			if _, err := database.ExecContext(ctx, `
				insert into user_preference(user_id,language,theme,updated_at)
				values('00000000-0000-0000-0000-000000000201','en','dark','2026-10-20T01:02:03.123456Z');
				insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
				values('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000201',
				'00000000-0000-0000-0000-000000000101','keeppref26','https://example.com/preserved','active',now(),now());
				insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
				values('00000000-0000-0000-0000-000000000102','https://extra.example.com','Extra','short_link',true,false,now(),now());
				insert into user_domain_preference(user_id,domain_id)
				values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101'),
				('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000102')
			`); err != nil {
				t.Fatalf("persist valid domain selections: %v", err)
			}
			var selected string
			var revision time.Time
			if err := database.QueryRowContext(ctx, `select domain_id::text,updated_at from user_domain_preference where user_id='00000000-0000-0000-0000-000000000201'`).Scan(&selected, &revision); err != nil || selected != "00000000-0000-0000-0000-000000000101" || revision.IsZero() {
				t.Fatalf("saved selection/version: %s %v %v", selected, revision, err)
			}
			for _, invalid := range []struct{ query, code string }{
				{`insert into user_domain_preference(user_id) values('00000000-0000-0000-0000-000000000201')`, "23505"},
				{`insert into user_domain_preference(user_id) values('00000000-0000-0000-0000-000000000299')`, "23503"},
				{`update user_domain_preference set domain_id='00000000-0000-0000-0000-000000000199'`, "23503"},
				{`delete from domain where id='00000000-0000-0000-0000-000000000102'`, "23503"},
			} {
				_, err := database.ExecContext(ctx, invalid.query)
				var pgErr *pgconn.PgError
				if !errors.As(err, &pgErr) || pgErr.Code != invalid.code {
					t.Fatalf("reference/uniqueness contract: got %v, want SQLSTATE %s", err, invalid.code)
				}
			}
			if _, err := database.ExecContext(ctx, `
				update user_domain_preference set domain_id=null where user_id='00000000-0000-0000-0000-000000000201';
				delete from app_user where id='00000000-0000-0000-0000-000000000202'
			`); err != nil {
				t.Fatalf("clear selection/cascade deleted account: %v", err)
			}
			if err := database.QueryRowContext(ctx, `select count(*) from user_domain_preference where domain_id is null`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("cleared selection was not retained: %d %v", count, err)
			}
			if err := database.QueryRowContext(ctx, `select count(*) from user_domain_preference`).Scan(&count); err != nil || count != 1 {
				t.Fatalf("account preference did not cascade: %d %v", count, err)
			}
			var accountRevision, interfaceRevision string
			if err := database.QueryRowContext(ctx, `select u.updated_at::text,p.updated_at::text from app_user u join user_preference p on p.user_id=u.id where u.username='alice'`).Scan(&accountRevision, &interfaceRevision); err != nil {
				t.Fatal(err)
			}
			if err := goose.DownTo(database, dir, 24); err != nil {
				t.Fatal(err)
			}
			assertRelationExists(t, ctx, database, "user_domain_preference", false)
			var preserved bool
			if err := database.QueryRowContext(ctx, `
				select u.updated_at::text=$1 and p.updated_at::text=$2 and p.language='en' and p.theme='dark'
				and d.host='go.example.com' and l.slug='keeppref26' and l.target_url='https://example.com/preserved'
				from app_user u join user_preference p on p.user_id=u.id
				join short_link l on l.owner_id=u.id join domain d on d.id=l.domain_id where u.username='alice'
			`, accountRevision, interfaceRevision).Scan(&preserved); err != nil || !preserved {
				t.Fatalf("rollback modified pre-existing data: preserved=%v err=%v", preserved, err)
			}
			if err := goose.Up(database, dir); err != nil {
				t.Fatal(err)
			}
			if err := database.QueryRowContext(ctx, `select count(*) from user_domain_preference`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("reapply should create an empty preference table: %d %v", count, err)
			}
		})
	}
}
