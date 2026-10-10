package db_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
)

// TestSystemSettingQueriesSupportTransactionalReadsAndUpdates exercises the generated settings contract.
func TestSystemSettingQueriesSupportTransactionalReadsAndUpdates(t *testing.T) {
	ctx := t.Context()
	pool := sqlcTestPool(t, ctx)
	queries := sqlc.New(pool)

	rows, err := queries.ListSystemSettings(ctx, []string{"site.footer_text", "site.show_powered_by"})
	if err != nil {
		t.Fatalf("list system settings: %v", err)
	}
	if len(rows) != 2 || rows[0].Key != "site.footer_text" || rows[1].Key != "site.show_powered_by" {
		t.Fatalf("listed settings = %#v", rows)
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin settings transaction: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	txQueries := queries.WithTx(tx)
	locked, err := txQueries.GetSystemSettingForUpdate(ctx, "site.settings_revision")
	if err != nil {
		t.Fatalf("lock settings revision: %v", err)
	}
	nextUpdatedAt := locked.UpdatedAt.Time.Add(time.Microsecond)
	updated, err := txQueries.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{
		Key: "site.footer_text", Value: json.RawMessage(`"Renamed"`),
		UpdatedAt: pgtype.Timestamptz{Time: nextUpdatedAt, Valid: true},
	})
	if err != nil {
		t.Fatalf("update system setting: %v", err)
	}
	if string(updated.Value) != `"Renamed"` || !updated.UpdatedAt.Time.Equal(nextUpdatedAt) {
		t.Fatalf("updated setting = %#v", updated)
	}
}
