package db_test

import (
	"path/filepath"
	"testing"

	"github.com/pressly/goose/v3"
)

// TestUserPreferenceMigrationRoundTrip preserves user metadata while adding and removing nullable preferences.
func TestUserPreferenceMigrationRoundTrip(t *testing.T) {
	ctx := t.Context()
	database := migrationTestDatabase(t, ctx)
	dir := filepath.Join("..", "..", "migrations")
	if err := goose.UpTo(database, dir, 17); err != nil {
		t.Fatal(err)
	}
	insertUserGroups(t, ctx, database)
	var original string
	if err := database.QueryRowContext(ctx, `select updated_at::text from app_user where id='00000000-0000-0000-0000-000000000201'`).Scan(&original); err != nil {
		t.Fatal(err)
	}
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	assertRelationExists(t, ctx, database, "user_preference", true)
	var count int
	if err := database.QueryRowContext(ctx, `select count(*) from user_preference`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("migration backfilled %d rows", count)
	}
	for _, values := range []string{`null,null`, `'zh-CN','system'`, `'en','light'`, `'en','dark'`} {
		if _, err := database.ExecContext(ctx, `insert into user_preference(user_id,language,theme) values('00000000-0000-0000-0000-000000000201',`+values+`) on conflict(user_id) do update set language=excluded.language,theme=excluded.theme`); err != nil {
			t.Fatal(err)
		}
	}
	for _, values := range []string{`'fr','light'`, `'en','auto'`} {
		if _, err := database.ExecContext(ctx, `update user_preference set (language,theme)=(`+values+`)`); err == nil {
			t.Fatalf("accepted invalid values %s", values)
		}
	}
	if err := goose.DownTo(database, dir, 17); err != nil {
		t.Fatal(err)
	}
	assertRelationExists(t, ctx, database, "user_preference", false)
	var after string
	if err := database.QueryRowContext(ctx, `select updated_at::text from app_user where id='00000000-0000-0000-0000-000000000201'`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if original != after {
		t.Fatalf("user metadata changed: %s -> %s", original, after)
	}
	if err := goose.Up(database, dir); err != nil {
		t.Fatal(err)
	}
	assertRelationExists(t, ctx, database, "user_preference", true)
	if _, err := database.ExecContext(ctx, `insert into user_preference(user_id) values('00000000-0000-0000-0000-000000000201'); delete from app_user where id='00000000-0000-0000-0000-000000000201'`); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx, `select count(*) from user_preference`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("preferences did not cascade with user deletion")
	}
}
