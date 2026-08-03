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

// TestShortLinkExpirationQueriesUseDatabaseTime locks the database-owned expiration contract.
func TestShortLinkExpirationQueriesUseDatabaseTime(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, linkID)

	connection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire PostgreSQL connection: %v", err)
	}
	defer connection.Release()
	if _, err := connection.Exec(ctx, `set time zone 'Pacific/Kiritimati'`); err != nil {
		t.Fatalf("set non-UTC session timezone: %v", err)
	}

	queries := sqlc.New(connection)
	databaseTime, err := queries.GetDatabaseTime(ctx)
	if err != nil || !databaseTime.Valid {
		t.Fatalf("read database time: %v, %#v", err, databaseTime)
	}
	pastWithOffset := databaseTime.Time.Add(-time.Minute).In(time.FixedZone("UTC-11", -11*60*60))
	if _, err := connection.Exec(ctx, `update short_link set expires_at = $1 where id = $2`, pastWithOffset, linkID); err != nil {
		t.Fatalf("set past expiration with offset: %v", err)
	}

	bySlug, err := queries.GetShortLinkBySlug(ctx, "abc123")
	if err != nil || !bySlug.Expired {
		t.Fatalf("expected slug query to use database expiration state: %v, %#v", err, bySlug)
	}
	ownerRows, err := queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{OwnerID: uuidToPgtype(ownerID), Limit: 20})
	if err != nil || len(ownerRows) != 1 || !ownerRows[0].Expired {
		t.Fatalf("expected owner list to use database expiration state: %v, %#v", err, ownerRows)
	}
	adminRows, err := queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{Limit: 20})
	if err != nil || len(adminRows) != 1 || !adminRows[0].Expired {
		t.Fatalf("expected admin list to use database expiration state: %v, %#v", err, adminRows)
	}

	futureWithOffset := databaseTime.Time.Add(time.Hour).In(time.FixedZone("UTC+13", 13*60*60))
	if _, err := connection.Exec(ctx, `update short_link set expires_at = $1 where id = $2`, futureWithOffset, linkID); err != nil {
		t.Fatalf("set future expiration with offset: %v", err)
	}
	bySlug, err = queries.GetShortLinkBySlug(ctx, "abc123")
	if err != nil || bySlug.Expired {
		t.Fatalf("expected future database expiration to remain active: %v, %#v", err, bySlug)
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

// TestShortLinkAccessConfigQueries verifies generated create, read, list, and update contracts.
func TestShortLinkAccessConfigQueries(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	fixtureID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	configuredID := uuid.MustParse("00000000-0000-0000-0000-000000000302")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, fixtureID)
	var expiresAt time.Time
	if err := pool.QueryRow(ctx, `select now() + interval '24 hours'`).Scan(&expiresAt); err != nil {
		t.Fatalf("read database future time: %v", err)
	}
	expiresAt = expiresAt.Truncate(time.Second)

	created, err := queries.CreateShortLink(ctx, sqlc.CreateShortLinkParams{
		ID:                       uuidToPgtype(configuredID),
		OwnerID:                  uuidToPgtype(ownerID),
		DomainID:                 uuidToPgtype(domainID),
		Slug:                     "config",
		TargetUrl:                "https://example.com/configured",
		Status:                   "active",
		RedirectMode:             "intermediate",
		IntermediateDelaySeconds: 7,
		ExpiresAt:                pgtype.Timestamptz{Time: expiresAt, Valid: true},
	})
	if err != nil {
		t.Fatalf("create configured short link: %v", err)
	}
	if created.RedirectMode != "intermediate" || created.IntermediateDelaySeconds != 7 || !created.ExpiresAt.Valid || !created.ExpiresAt.Time.Equal(expiresAt) || created.Expired {
		t.Fatalf("unexpected created access config: %#v", created)
	}

	bySlug, err := queries.GetShortLinkBySlug(ctx, "config")
	if err != nil {
		t.Fatalf("get configured short link: %v", err)
	}
	if bySlug.RedirectMode != "intermediate" || bySlug.IntermediateDelaySeconds != 7 || !bySlug.ExpiresAt.Valid || bySlug.Expired {
		t.Fatalf("unexpected slug access config: %#v", bySlug)
	}

	listed, err := queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Limit:   20,
		Offset:  0,
		Status:  pgtype.Text{},
	})
	if err != nil {
		t.Fatalf("list configured short link: %v", err)
	}
	var found bool
	for _, row := range listed {
		if row.ID == uuidToPgtype(configuredID) {
			found = true
			if row.RedirectMode != "intermediate" || row.IntermediateDelaySeconds != 7 || !row.ExpiresAt.Valid || row.Expired {
				t.Fatalf("unexpected listed access config: %#v", row)
			}
		}
	}
	if !found {
		t.Fatal("expected configured short link in owner list")
	}

	updated, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:                       uuidToPgtype(configuredID),
		OwnerID:                  uuidToPgtype(ownerID),
		TargetUrl:                pgtype.Text{},
		Status:                   pgtype.Text{String: "disabled", Valid: true},
		RedirectMode:             pgtype.Text{},
		IntermediateDelaySeconds: pgtype.Int2{},
		ExpirationMode:           "keep",
		ExpiresAt:                pgtype.Timestamptz{},
	})
	if err != nil {
		t.Fatalf("update configured short link status: %v", err)
	}
	if updated.RedirectMode != "intermediate" || updated.IntermediateDelaySeconds != 7 || !updated.ExpiresAt.Valid {
		t.Fatalf("status update cleared access config: %#v", updated)
	}

	cleared, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:                       uuidToPgtype(configuredID),
		OwnerID:                  uuidToPgtype(ownerID),
		TargetUrl:                pgtype.Text{},
		Status:                   pgtype.Text{},
		RedirectMode:             pgtype.Text{String: "direct", Valid: true},
		IntermediateDelaySeconds: pgtype.Int2{Int16: 5, Valid: true},
		ExpirationMode:           "never",
		ExpiresAt:                pgtype.Timestamptz{},
	})
	if err != nil {
		t.Fatalf("clear configured short link expiration: %v", err)
	}
	if cleared.RedirectMode != "direct" || cleared.IntermediateDelaySeconds != 5 || cleared.ExpiresAt.Valid {
		t.Fatalf("unexpected cleared access config: %#v", cleared)
	}

	ownerExpiresAt := expiresAt.Add(time.Hour)
	ownerConfigured, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		OwnerID:        uuidToPgtype(ownerID),
		ExpirationMode: "at",
		ExpiresAt:      pgtype.Timestamptz{Time: ownerExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatalf("set owner short link expiration: %v", err)
	}
	if !ownerConfigured.ExpiresAt.Valid || !ownerConfigured.ExpiresAt.Time.Equal(ownerExpiresAt) || ownerConfigured.Expired {
		t.Fatalf("unexpected owner expiration update: %#v", ownerConfigured)
	}

	adminExpiresAt := ownerExpiresAt.Add(time.Hour)
	adminConfigured, err := queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		ExpirationMode: "at",
		ExpiresAt:      pgtype.Timestamptz{Time: adminExpiresAt, Valid: true},
	})
	if err != nil {
		t.Fatalf("set admin short link expiration: %v", err)
	}
	if !adminConfigured.ExpiresAt.Valid || !adminConfigured.ExpiresAt.Time.Equal(adminExpiresAt) || adminConfigured.Expired {
		t.Fatalf("unexpected admin expiration update: %#v", adminConfigured)
	}
}

// TestShortLinkOverviewQuery verifies owner-scoped link and visit aggregates.
func TestShortLinkOverviewQuery(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)

	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	otherOwnerID := uuid.MustParse("00000000-0000-0000-0000-000000000202")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	activeLinkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	disabledLinkID := uuid.MustParse("00000000-0000-0000-0000-000000000302")
	deletedLinkID := uuid.MustParse("00000000-0000-0000-0000-000000000303")
	otherLinkID := uuid.MustParse("00000000-0000-0000-0000-000000000304")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, activeLinkID)

	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, 'bob', 'hash', 'Bob', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, otherOwnerID)
	if err != nil {
		t.Fatalf("insert other owner fixture: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at)
		values
			($1, $5, $6, 'disabled', 'https://example.com/disabled', 'disabled', now(), now(), null),
			($2, $5, $6, 'deleted', 'https://example.com/deleted', 'active', now(), now(), now()),
			($3, $4, $6, 'other1', 'https://example.com/other', 'active', now(), now(), null)
	`, disabledLinkID, deletedLinkID, otherLinkID, otherOwnerID, ownerID, domainID)
	if err != nil {
		t.Fatalf("insert overview link fixtures: %v", err)
	}
	_, err = pool.Exec(ctx, `
		insert into short_link_event (id, short_link_id, event_type, created_at)
		values
			($1, $5, 'redirect_response_sent', now()),
			($2, $9, 'redirect_response_sent', current_date - interval '1 day'),
			($3, $5, 'redirect_attempted', now()),
			($4, $6, 'redirect_response_sent', now()),
			($7, $8, 'redirect_response_sent', now())
	`, uuid.New(), uuid.New(), uuid.New(), uuid.New(), activeLinkID, deletedLinkID, uuid.New(), otherLinkID, disabledLinkID)
	if err != nil {
		t.Fatalf("insert overview event fixtures: %v", err)
	}

	overview, err := queries.GetShortLinkOverviewByOwner(ctx, uuidToPgtype(ownerID))
	if err != nil {
		t.Fatalf("get short link overview: %v", err)
	}
	if overview.TotalLinkCount != 2 || overview.ActiveLinkCount != 1 {
		t.Fatalf("unexpected link counts: %#v", overview)
	}
	if overview.VisitCount != 2 || overview.TodayVisitCount != 1 {
		t.Fatalf("unexpected visit counts: %#v", overview)
	}

	emptyOverview, err := queries.GetShortLinkOverviewByOwner(ctx, uuidToPgtype(uuid.New()))
	if err != nil {
		t.Fatalf("get empty short link overview: %v", err)
	}
	if emptyOverview.TotalLinkCount != 0 || emptyOverview.ActiveLinkCount != 0 || emptyOverview.VisitCount != 0 || emptyOverview.TodayVisitCount != 0 {
		t.Fatalf("expected zero-value overview, got %#v", emptyOverview)
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
