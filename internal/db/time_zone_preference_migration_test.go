package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

// TestTimeZonePreferenceMigration protects account data through Up/Down/Up and enforces valid choices in PostgreSQL.
func TestTimeZonePreferenceMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	if err := goose.UpTo(database, dir, 31); err != nil {
		t.Fatal(err)
	}
	insertUserGroups(t, ctx, database)
	if _, err := database.ExecContext(ctx, `insert into user_preference(user_id,language,theme,updated_at) values('00000000-0000-0000-0000-000000000201','en','dark','2026-10-20T01:02:03.123456Z');insert into user_domain_preference(user_id,domain_id,updated_at) values('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','2026-10-20T01:02:03.654321Z')`); err != nil {
		t.Fatal(err)
	}
	const snapshot = `select jsonb_build_object('account',(select to_jsonb(u) from app_user u where id='00000000-0000-0000-0000-000000000201'),'interface',(select jsonb_agg(to_jsonb(p)) from user_preference p),'domain',(select jsonb_agg(to_jsonb(p)) from user_domain_preference p))::text`
	var before string
	if err := database.QueryRowContext(ctx, snapshot).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := database.QueryRowContext(ctx, `select count(*) from user_time_zone_preference`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("unexpected backfill %d %v", count, err)
	}
	if _, err := database.ExecContext(ctx, `insert into user_time_zone_preference(user_id,time_zone) values('00000000-0000-0000-0000-000000000201','UTC'),('00000000-0000-0000-0000-000000000202',null)`); err != nil {
		t.Fatal(err)
	}
	for _, zone := range []any{nil, "UTC", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney"} {
		if _, err := database.ExecContext(ctx, `update user_time_zone_preference set time_zone=$1 where user_id='00000000-0000-0000-0000-000000000201'`, zone); err != nil {
			t.Fatalf("valid zone %v: %v", zone, err)
		}
	}
	for _, tc := range []struct{ sql, code string }{
		{`update user_time_zone_preference set time_zone='utc'`, "23514"},
		{`update user_time_zone_preference set time_zone='Etc/UTC'`, "23514"},
		{`update user_time_zone_preference set time_zone=' UTC'`, "23514"},
		{`update user_time_zone_preference set updated_at=null`, "23502"},
		{`insert into user_time_zone_preference(user_id) values('00000000-0000-0000-0000-000000000201')`, "23505"},
		{`insert into user_time_zone_preference(user_id) values('00000000-0000-0000-0000-000000000299')`, "23503"},
	} {
		_, err := database.ExecContext(ctx, tc.sql)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != tc.code {
			t.Fatalf("constraint %s got=%v want=%s", tc.sql, err, tc.code)
		}
	}
	if _, err := database.ExecContext(ctx, `delete from app_user where id='00000000-0000-0000-0000-000000000202'`); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `select count(*) from user_time_zone_preference`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("cascade count=%d %v", count, err)
	}
	if err := goose.DownTo(database, dir, 31); err != nil {
		t.Fatal(err)
	}
	assertRelationExists(t, ctx, database, "user_time_zone_preference", false)
	var after string
	if err := database.QueryRowContext(ctx, snapshot).Scan(&after); err != nil || before != after {
		t.Fatalf("old data changed: %s / %s %v", before, after, err)
	}
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `select count(*) from user_time_zone_preference`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("reapply rows=%d %v", count, err)
	}
}
