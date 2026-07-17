package db_test

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"
	"github.com/testcontainers/testcontainers-go"
	"github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// TestSQLCPackageExposesQueries verifies that generated queries can be constructed.
func TestSQLCPackageExposesQueries(t *testing.T) {
	queries := sqlc.New(nil)
	if queries == nil {
		t.Fatal("expected generated queries")
	}
}

// TestWithTxRollsBackAfterPanic verifies a panic releases the transaction connection.
func TestWithTxRollsBackAfterPanic(t *testing.T) {
	ctx := context.Background()
	databaseURL := migratedSQLCDatabaseURL(t, ctx)
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}
	poolConfig.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	func() {
		defer func() {
			if recover() == nil {
				t.Fatal("expected transaction callback panic")
			}
		}()
		_ = appdb.WithTx(ctx, pool, func(pgx.Tx) error {
			panic("transaction callback panic")
		})
	}()

	queryCtx, cancel := context.WithTimeout(ctx, 200*time.Millisecond)
	defer cancel()
	var value int
	if err := pool.QueryRow(queryCtx, `select 1`).Scan(&value); err != nil {
		t.Fatalf("expected rollback to release the connection: %v", err)
	}
}

// TestShortLinkStatisticsQueries verifies list queries return persisted visit aggregates.
func TestShortLinkStatisticsQueries(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)

	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, linkID)

	for i := 0; i < 2; i++ {
		err := queries.CreateShortLinkEvent(ctx, sqlc.CreateShortLinkEventParams{
			ID:          uuidToPgtype(uuid.New()),
			ShortLinkID: uuidToPgtype(linkID),
			EventType:   event.RedirectResponseSent,
		})
		if err != nil {
			t.Fatalf("create short link event: %v", err)
		}
	}

	rows, err := queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Limit:   20,
		Offset:  0,
		Status:  pgtype.Text{},
	})
	if err != nil {
		t.Fatalf("list short links: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].VisitCount != 2 {
		t.Fatalf("expected visit count 2, got %d", rows[0].VisitCount)
	}
	if rows[0].TodayVisitCount != 2 {
		t.Fatalf("expected today visit count 2, got %d", rows[0].TodayVisitCount)
	}
	if !rows[0].LastVisitedAt.Valid {
		t.Fatal("expected last visited at")
	}

	adminRows, err := queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{
		Limit:  20,
		Offset: 0,
		Status: pgtype.Text{},
		Query:  "",
	})
	if err != nil {
		t.Fatalf("list all short links: %v", err)
	}
	if len(adminRows) != 1 {
		t.Fatalf("expected 1 admin row, got %d", len(adminRows))
	}
	if adminRows[0].VisitCount != 2 || adminRows[0].TodayVisitCount != 2 || !adminRows[0].LastVisitedAt.Valid {
		t.Fatalf("unexpected admin statistics: %#v", adminRows[0])
	}
}

// insertSQLCShortLinkFixtures creates the owner, domain, and link required by SQLC tests.
func insertSQLCShortLinkFixtures(t *testing.T, ctx context.Context, pool sqlc.DBTX, ownerID uuid.UUID, domainID uuid.UUID, linkID uuid.UUID) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert user group fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, 'alice', 'hash', 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, ownerID)
	if err != nil {
		t.Fatalf("insert app user fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'go.example.com', 'Default', 'short_link', true, true, now(), now())
	`, domainID)
	if err != nil {
		t.Fatalf("insert domain fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at)
		values ($1, $2, $3, 'abc123', 'https://example.com', 'active', now(), now())
	`, linkID, ownerID, domainID)
	if err != nil {
		t.Fatalf("insert short link fixture: %v", err)
	}
}

// sqlcTestPool opens a migrated PostgreSQL pool for SQLC integration tests.
func sqlcTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := migratedSQLCDatabaseURL(t, ctx)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// migratedSQLCDatabaseURL starts PostgreSQL and applies all project migrations.
func migratedSQLCDatabaseURL(t *testing.T, ctx context.Context) string {
	t.Helper()

	container, err := postgres.Run(ctx,
		"postgres:18-alpine",
		postgres.WithDatabase("moeurl_test"),
		postgres.WithUsername("moeurl"),
		postgres.WithPassword("moeurl"),
		testcontainers.WithWaitStrategy(
			wait.ForLog("database system is ready to accept connections").
				WithOccurrence(2).
				WithStartupTimeout(60*time.Second),
		),
	)
	if err != nil {
		t.Fatalf("start postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := testcontainers.TerminateContainer(container); err != nil {
			t.Fatalf("terminate postgres container: %v", err)
		}
	})

	databaseURL, err := container.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("get connection string: %v", err)
	}

	database, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	t.Cleanup(func() {
		_ = database.Close()
	})

	if err := goose.SetDialect("postgres"); err != nil {
		t.Fatalf("set goose dialect: %v", err)
	}
	if err := goose.Up(database, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatalf("run migrations: %v", err)
	}

	return databaseURL
}

// uuidToPgtype converts a UUID into the pgx value used by generated queries.
func uuidToPgtype(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
