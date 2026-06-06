package db_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
)

func TestSQLCPackageExposesQueries(t *testing.T) {
	queries := sqlc.New(nil)
	if queries == nil {
		t.Fatal("expected generated queries")
	}
}
