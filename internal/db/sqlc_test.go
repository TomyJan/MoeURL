package db_test

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSQLCPackageExposesQueries verifies that generated queries can be constructed.
func TestSQLCPackageExposesQueries(t *testing.T) {
	queries := sqlc.New(nil)
	if queries == nil {
		t.Fatal("expected generated queries")
	}
}

// TestShortLinkConfirmationQueriesRoundTrip verifies existing SQLC queries preserve confirmation mode.
func TestShortLinkConfirmationQueriesRoundTrip(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	fixtureID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	confirmationID := uuid.MustParse("00000000-0000-0000-0000-000000000302")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, fixtureID)

	created, err := queries.CreateShortLink(ctx, sqlc.CreateShortLinkParams{
		ID:                       uuidToPgtype(confirmationID),
		OwnerID:                  uuidToPgtype(ownerID),
		DomainID:                 uuidToPgtype(domainID),
		Slug:                     "confirm1",
		TargetUrl:                "https://example.com/confirmation",
		Status:                   "active",
		RedirectMode:             "confirmation",
		IntermediateDelaySeconds: 5,
	})
	if err != nil || created.RedirectMode != "confirmation" {
		t.Fatalf("create confirmation short link: %v, %#v", err, created)
	}

	bySlug, err := queries.GetShortLinkBySlug(ctx, "confirm1")
	if err != nil || bySlug.RedirectMode != "confirmation" {
		t.Fatalf("get confirmation short link by slug: %v, %#v", err, bySlug)
	}
	ownerRows, err := queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{
		OwnerID: uuidToPgtype(ownerID),
		Limit:   20,
	})
	if err != nil || findOwnerRedirectMode(ownerRows, confirmationID) != "confirmation" {
		t.Fatalf("list owner confirmation short link: %v, %#v", err, ownerRows)
	}
	adminRows, err := queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{Limit: 20})
	if err != nil || findAdminRedirectMode(adminRows, confirmationID) != "confirmation" {
		t.Fatalf("list admin confirmation short link: %v, %#v", err, adminRows)
	}

	updated, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:             uuidToPgtype(confirmationID),
		OwnerID:        uuidToPgtype(ownerID),
		RedirectMode:   pgtype.Text{String: "direct", Valid: true},
		ExpirationMode: "unchanged",
		PasswordMode:   "unchanged",
	})
	if err != nil || updated.RedirectMode != "direct" {
		t.Fatalf("update owner confirmation mode: %v, %#v", err, updated)
	}
	adminUpdated, err := queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:             uuidToPgtype(confirmationID),
		RedirectMode:   pgtype.Text{String: "confirmation", Valid: true},
		ExpirationMode: "unchanged",
		PasswordMode:   "unchanged",
	})
	if err != nil || adminUpdated.RedirectMode != "confirmation" {
		t.Fatalf("update admin confirmation mode: %v, %#v", err, adminUpdated)
	}
}

// findOwnerRedirectMode returns the fixture value used by the surrounding assertions.
func findOwnerRedirectMode(rows []sqlc.ListShortLinksByOwnerRow, id uuid.UUID) string {
	for _, row := range rows {
		if row.ID.Valid && uuid.UUID(row.ID.Bytes) == id {
			return row.RedirectMode
		}
	}
	return ""
}

// findAdminRedirectMode returns the fixture value used by the surrounding assertions.
func findAdminRedirectMode(rows []sqlc.ListAllShortLinksRow, id uuid.UUID) string {
	for _, row := range rows {
		if row.ID.Valid && uuid.UUID(row.ID.Bytes) == id {
			return row.RedirectMode
		}
	}
	return ""
}

// TestGetShortLinkPasswordStateBySlugForUpdateReturnsPasswordState verifies get short link password state by slug for update returns password state.
func TestGetShortLinkPasswordStateBySlugForUpdateReturnsPasswordState(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, linkID)

	if _, err := pool.Exec(ctx, `update short_link set password_hash = 'stored-hash' where id = $1`, linkID); err != nil {
		t.Fatalf("set password fixture: %v", err)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin password state transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	state, err := sqlc.New(tx).GetShortLinkPasswordStateBySlugForUpdate(ctx, "abc123")
	if err != nil {
		t.Fatalf("get password state by slug: %v", err)
	}
	if state.ID.Bytes != linkID || !state.PasswordHash.Valid || state.PasswordHash.String != "stored-hash" {
		t.Fatalf("unexpected password state: %#v", state)
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
	ownerRows, err = queries.ListShortLinksByOwner(ctx, sqlc.ListShortLinksByOwnerParams{OwnerID: uuidToPgtype(ownerID), Limit: 20})
	if err != nil || len(ownerRows) != 1 || ownerRows[0].Expired {
		t.Fatalf("expected future owner list expiration to remain active: %v, %#v", err, ownerRows)
	}
	adminRows, err = queries.ListAllShortLinks(ctx, sqlc.ListAllShortLinksParams{Limit: 20})
	if err != nil || len(adminRows) != 1 || adminRows[0].Expired {
		t.Fatalf("expected future admin list expiration to remain active: %v, %#v", err, adminRows)
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
	emptyPasswordID := uuid.MustParse("00000000-0000-0000-0000-000000000303")
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
		PasswordHash:             pgtype.Text{String: "$argon2id$v=19$m=1,t=1,p=1$test", Valid: true},
	})
	if err != nil {
		t.Fatalf("create configured short link: %v", err)
	}
	if created.RedirectMode != "intermediate" || created.IntermediateDelaySeconds != 7 || !created.ExpiresAt.Valid || !created.ExpiresAt.Time.Equal(expiresAt) || created.Expired || !created.PasswordHash.Valid {
		t.Fatalf("unexpected created access config: %#v", created)
	}

	emptyPassword, err := queries.CreateShortLink(ctx, sqlc.CreateShortLinkParams{
		ID:                       uuidToPgtype(emptyPasswordID),
		OwnerID:                  uuidToPgtype(ownerID),
		DomainID:                 uuidToPgtype(domainID),
		Slug:                     "empty-password",
		TargetUrl:                "https://example.com/empty-password",
		Status:                   "active",
		RedirectMode:             "direct",
		IntermediateDelaySeconds: 5,
		PasswordHash:             pgtype.Text{String: "", Valid: true},
	})
	if err != nil {
		t.Fatalf("create short link with empty password hash: %v", err)
	}
	if emptyPassword.PasswordHash.Valid {
		t.Fatal("empty password hash was persisted")
	}
	var emptyPasswordUpdatedAt pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `select password_updated_at from short_link where id = $1`, emptyPasswordID).Scan(&emptyPasswordUpdatedAt); err != nil {
		t.Fatalf("read empty password timestamp: %v", err)
	}
	if emptyPasswordUpdatedAt.Valid {
		t.Fatal("empty password hash received a password update timestamp")
	}

	bySlug, err := queries.GetShortLinkBySlug(ctx, "config")
	if err != nil {
		t.Fatalf("get configured short link: %v", err)
	}
	if bySlug.RedirectMode != "intermediate" || bySlug.IntermediateDelaySeconds != 7 || !bySlug.ExpiresAt.Valid || bySlug.Expired || !bySlug.PasswordHash.Valid {
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
			if row.RedirectMode != "intermediate" || row.IntermediateDelaySeconds != 7 || !row.ExpiresAt.Valid || row.Expired || !row.HasPassword {
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
	if !updated.PasswordUpdatedAt.Valid {
		t.Fatalf("expected initial password update timestamp, got %#v", updated.PasswordUpdatedAt)
	}
	if _, err := pool.Exec(ctx, `select pg_sleep(0.01)`); err != nil {
		t.Fatalf("separate password update timestamps: %v", err)
	}

	ownerEmptyPassword, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		OwnerID:        uuidToPgtype(ownerID),
		PasswordMode:   "set",
		PasswordHash:   pgtype.Text{},
		ExpirationMode: "keep",
	})
	if err != nil {
		t.Fatalf("ignore empty owner password hash: %v", err)
	}
	if !ownerEmptyPassword.PasswordHash.Valid || ownerEmptyPassword.PasswordHash.String != updated.PasswordHash.String || !ownerEmptyPassword.PasswordUpdatedAt.Time.Equal(updated.PasswordUpdatedAt.Time) {
		t.Fatalf("empty owner password hash changed password state: %#v", ownerEmptyPassword)
	}

	adminEmptyPassword, err := queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		PasswordMode:   "set",
		PasswordHash:   pgtype.Text{String: "", Valid: true},
		ExpirationMode: "keep",
	})
	if err != nil {
		t.Fatalf("ignore empty admin password hash: %v", err)
	}
	if !adminEmptyPassword.PasswordHash.Valid || adminEmptyPassword.PasswordHash.String != updated.PasswordHash.String || !adminEmptyPassword.PasswordUpdatedAt.Time.Equal(updated.PasswordUpdatedAt.Time) {
		t.Fatalf("empty admin password hash changed password state: %#v", adminEmptyPassword)
	}

	passwordUpdated, err := queries.UpdateOwnShortLink(ctx, sqlc.UpdateOwnShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		OwnerID:        uuidToPgtype(ownerID),
		PasswordMode:   "never",
		PasswordHash:   pgtype.Text{},
		ExpirationMode: "keep",
	})
	if err != nil {
		t.Fatalf("clear short link password: %v", err)
	}
	if passwordUpdated.PasswordHash.Valid {
		t.Fatalf("expected cleared password hash, got %#v", passwordUpdated.PasswordHash)
	}
	if !passwordUpdated.PasswordUpdatedAt.Valid || !passwordUpdated.PasswordUpdatedAt.Time.After(updated.PasswordUpdatedAt.Time) {
		t.Fatalf("expected refreshed password update timestamp, got %#v after %#v", passwordUpdated.PasswordUpdatedAt, updated.PasswordUpdatedAt)
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
	if _, err := pool.Exec(ctx, `
		update short_link
		set password_failed_attempts = 5,
			password_window_started_at = now() - interval '1 minute',
			password_blocked_until = now() + interval '15 minutes'
		where id = $1
	`, configuredID); err != nil {
		t.Fatalf("set admin password failure fixture: %v", err)
	}
	if _, err := queries.UpdateAnyShortLink(ctx, sqlc.UpdateAnyShortLinkParams{
		ID:             uuidToPgtype(configuredID),
		ExpirationMode: "keep",
		PasswordMode:   "set",
		PasswordHash:   pgtype.Text{String: "admin-updated-hash", Valid: true},
	}); err != nil {
		t.Fatalf("update admin short link password: %v", err)
	}
	adminPasswordState, err := queries.GetShortLinkPasswordStateForUpdate(ctx, uuidToPgtype(configuredID))
	if err != nil {
		t.Fatalf("read admin password failure state: %v", err)
	}
	if adminPasswordState.PasswordFailedAttempts != 0 || adminPasswordState.PasswordWindowStartedAt.Valid || adminPasswordState.PasswordBlockedUntil.Valid {
		t.Fatalf("admin password update retained failure state: %#v", adminPasswordState)
	}
}

// TestShortLinkAccessGrantUsesIssuanceTimeAfterConcurrentPasswordUpdate verifies stale grants cannot survive a password update race.
func TestShortLinkAccessGrantUsesIssuanceTimeAfterConcurrentPasswordUpdate(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, linkID)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin grant transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	txQueries := queries.WithTx(tx)
	if _, err := txQueries.GetDatabaseTime(ctx); err != nil {
		t.Fatalf("establish grant transaction time: %v", err)
	}
	if _, err := tx.Exec(ctx, `select pg_sleep(0.01)`); err != nil {
		t.Fatalf("separate transaction timestamps: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update short_link
		set password_hash = 'updated-hash', password_updated_at = clock_timestamp()
		where id = $1
	`, linkID); err != nil {
		t.Fatalf("update password after grant transaction started: %v", err)
	}

	tokenHash := "concurrent-password-update-token"
	if _, err := txQueries.CreateShortLinkAccessGrant(ctx, sqlc.CreateShortLinkAccessGrantParams{
		ID:          uuidToPgtype(uuid.New()),
		ShortLinkID: uuidToPgtype(linkID),
		TokenHash:   tokenHash,
		ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("create access grant: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit access grant: %v", err)
	}

	if _, err := queries.GetValidShortLinkAccessGrant(ctx, sqlc.GetValidShortLinkAccessGrantParams{
		ShortLinkID: uuidToPgtype(linkID),
		TokenHash:   tokenHash,
	}); err != nil {
		t.Fatalf("expected newly issued grant to survive an earlier password update: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set deleted_at = clock_timestamp() where id = $1`, linkID); err != nil {
		t.Fatalf("soft delete granted short link: %v", err)
	}
	if _, err := queries.GetValidShortLinkAccessGrant(ctx, sqlc.GetValidShortLinkAccessGrantParams{
		ShortLinkID: uuidToPgtype(linkID),
		TokenHash:   tokenHash,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("soft-deleted short link grant error = %v, want pgx.ErrNoRows", err)
	}
}

// TestShortLinkPasswordUpdateUsesLockAcquisitionTimeToInvalidateGrants verifies invalidation uses transaction serialization time.
func TestShortLinkPasswordUpdateUsesLockAcquisitionTimeToInvalidateGrants(t *testing.T) {
	ctx := context.Background()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)
	ownerID := uuid.MustParse("00000000-0000-0000-0000-000000000201")
	domainID := uuid.MustParse("00000000-0000-0000-0000-000000000101")
	linkID := uuid.MustParse("00000000-0000-0000-0000-000000000301")
	insertSQLCShortLinkFixtures(t, ctx, pool, ownerID, domainID, linkID)
	if _, err := pool.Exec(ctx, `update short_link set password_hash = 'initial-hash', password_updated_at = clock_timestamp() where id = $1`, linkID); err != nil {
		t.Fatalf("set initial password state: %v", err)
	}

	grantTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin grant transaction: %v", err)
	}
	defer func() { _ = grantTx.Rollback(ctx) }()
	grantQueries := queries.WithTx(grantTx)
	if _, err := grantQueries.GetShortLinkPasswordStateForUpdate(ctx, uuidToPgtype(linkID)); err != nil {
		t.Fatalf("lock short link for grant: %v", err)
	}

	updateTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin password update transaction: %v", err)
	}
	updateResult := make(chan error, 1)
	updateContext, cancelUpdate := context.WithCancel(ctx)
	updateStarted := false
	updateFinished := false
	defer func() {
		cancelUpdate()
		if updateStarted && !updateFinished {
			<-updateResult
		}
		_ = updateTx.Rollback(ctx)
	}()
	updateQueries := queries.WithTx(updateTx)
	if _, err := updateQueries.GetDatabaseTime(ctx); err != nil {
		t.Fatalf("establish password update transaction time: %v", err)
	}
	var updatePID int32
	if err := updateTx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&updatePID); err != nil {
		t.Fatalf("read password update backend pid: %v", err)
	}

	updateStarted = true
	go func() {
		_, updateErr := updateQueries.UpdateAnyShortLink(updateContext, sqlc.UpdateAnyShortLinkParams{
			ID:             uuidToPgtype(linkID),
			ExpirationMode: "keep",
			PasswordMode:   "set",
			PasswordHash:   pgtype.Text{String: "updated-hash", Valid: true},
		})
		updateResult <- updateErr
	}()

	deadline := time.Now().Add(15 * time.Second)
	for {
		var waitingLock int
		err := pool.QueryRow(ctx, `
			select 1
			from pg_locks
			where pid = $1 and not granted
			limit 1
		`, updatePID).Scan(&waitingLock)
		if err == nil {
			break
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("read password update lock state: %v", err)
		}
		select {
		case updateErr := <-updateResult:
			updateFinished = true
			t.Fatalf("password update returned before lock release: %v", updateErr)
		default:
		}
		if time.Now().After(deadline) {
			t.Fatal("password update did not wait for the short-link lock")
		}
		time.Sleep(5 * time.Millisecond)
	}

	tokenHash := "grant-created-before-waiting-update"
	if _, err := grantQueries.CreateShortLinkAccessGrant(ctx, sqlc.CreateShortLinkAccessGrantParams{
		ID:          uuidToPgtype(uuid.New()),
		ShortLinkID: uuidToPgtype(linkID),
		TokenHash:   tokenHash,
		ExpiresAt:   pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true},
	}); err != nil {
		t.Fatalf("create access grant while password update waits: %v", err)
	}
	if err := grantTx.Commit(ctx); err != nil {
		t.Fatalf("commit access grant: %v", err)
	}
	if err := <-updateResult; err != nil {
		updateFinished = true
		t.Fatalf("update password after lock release: %v", err)
	}
	updateFinished = true
	if err := updateTx.Commit(ctx); err != nil {
		t.Fatalf("commit password update: %v", err)
	}
	var createdAt, passwordUpdatedAt time.Time
	if err := pool.QueryRow(ctx, `
		select access_grant.created_at, short_link.password_updated_at
		from short_link_access_grant as access_grant
		join short_link on short_link.id = access_grant.short_link_id
		where access_grant.token_hash = $1
	`, tokenHash).Scan(&createdAt, &passwordUpdatedAt); err != nil {
		t.Fatalf("read grant timestamps: %v", err)
	}
	t.Logf("grant created at %s, password updated at %s", createdAt.Format(time.RFC3339Nano), passwordUpdatedAt.Format(time.RFC3339Nano))

	if _, err := queries.GetValidShortLinkAccessGrant(ctx, sqlc.GetValidShortLinkAccessGrantParams{
		ShortLinkID: uuidToPgtype(linkID),
		TokenHash:   tokenHash,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected password update to invalidate the earlier grant, got %v", err)
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
	return testdb.MigratedDatabaseURL(ctx, t, filepath.Join("..", "..", "migrations"))
}

// uuidToPgtype converts a UUID into the pgx value used by generated queries.
func uuidToPgtype(value uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: value, Valid: true}
}
