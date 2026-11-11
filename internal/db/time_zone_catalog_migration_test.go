package db_test

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pressly/goose/v3"
)

// TestTimeZoneCatalogMigration catches a permissive CHECK, destructive downgrade,
// changed revisions, or a failed downgrade that incorrectly advances Goose state.
func TestTimeZoneCatalogMigration(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	if err := goose.UpTo(database, dir, 37); err != nil {
		t.Fatal(err)
	}
	insertUserGroups(t, ctx, database)
	if _, err := database.ExecContext(ctx, `insert into user_time_zone_preference(user_id,time_zone,updated_at) values
		('00000000-0000-0000-0000-000000000201','UTC','2026-10-20T01:02:03.123456Z'),
		('00000000-0000-0000-0000-000000000202',null,'2026-10-20T01:02:03.654321Z')`); err != nil {
		t.Fatal(err)
	}
	const snapshot = `select jsonb_build_object('users',(select jsonb_agg(to_jsonb(u) order by id) from app_user u),'interface',(select jsonb_agg(to_jsonb(p) order by user_id) from user_preference p),'domain',(select jsonb_agg(to_jsonb(p) order by user_id) from user_domain_preference p),'time',(select jsonb_agg(to_jsonb(p) order by user_id) from user_time_zone_preference p))::text`
	read := func() string {
		t.Helper()
		var value string
		if err := database.QueryRowContext(ctx, snapshot).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := read()
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	if got := read(); got != before {
		t.Fatalf("upgrade changed existing data: %s / %s", before, got)
	}
	for _, zone := range []string{"Pacific/Chatham", "Asia/Katmandu", "America/Port-au-Prince"} {
		if _, err := database.ExecContext(ctx, `update user_time_zone_preference set time_zone=$1 where user_id='00000000-0000-0000-0000-000000000201'`, zone); err != nil {
			t.Fatalf("new zone %s rejected: %v", zone, err)
		}
	}
	for _, zone := range []string{"Etc/UTC", "Asia/Kathmandu", "UTC ", "utc", "../Asia/Tokyo", "Invalid/Zone"} {
		_, err := database.ExecContext(ctx, `update user_time_zone_preference set time_zone=$1 where user_id='00000000-0000-0000-0000-000000000201'`, zone)
		var pgErr *pgconn.PgError
		if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
			t.Fatalf("invalid zone %s: %v", zone, err)
		}
	}
	expanded := read()
	if err := goose.Down(database, dir); err == nil {
		t.Fatal("downgrade discarded an expanded preference")
	}
	if got := read(); got != expanded {
		t.Fatalf("failed downgrade changed values or revisions: %s / %s", expanded, got)
	}
	if version, err := goose.GetDBVersion(database); err != nil || version != 38 {
		t.Fatalf("failed downgrade version=%d err=%v", version, err)
	}
	if _, err := database.ExecContext(ctx, `update user_time_zone_preference set time_zone='UTC' where user_id='00000000-0000-0000-0000-000000000201'`); err != nil {
		t.Fatal(err)
	}
	compatible := read()
	if err := goose.Down(database, dir); err != nil {
		t.Fatal(err)
	}
	if got := read(); got != compatible {
		t.Fatalf("compatible downgrade changed data: %s / %s", compatible, got)
	}
	_, err := database.ExecContext(ctx, `update user_time_zone_preference set time_zone='Pacific/Chatham'`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		t.Fatalf("old CHECK was not restored: %v", err)
	}
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	if got := read(); got != compatible || got != before {
		t.Fatalf("reapply changed original data: %s / %s", before, got)
	}
}
