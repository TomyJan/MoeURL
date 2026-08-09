package user_test

import (
	"context"
	"encoding/json"
	"testing"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
)

func userTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := testdb.ProjectMigratedDatabaseURL(t, ctx)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func insertUserGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, key string, permissions []string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, $1, '', $2::jsonb, false, now(), now())
	`, key, permissionsJSON(permissions))
	if err != nil {
		t.Fatalf("insert user group: %v", err)
	}
}

func permissionsJSON(permissions []string) string {
	data, err := json.Marshal(permissions)
	if err != nil {
		panic(err)
	}
	return string(data)
}
