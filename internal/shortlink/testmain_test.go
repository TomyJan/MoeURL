package shortlink_test

import (
	"os"
	"testing"

	"github.com/TomyJan/MoeURL/internal/testdb"
)

// TestMain ensures the package-wide PostgreSQL container is terminated before exit.
func TestMain(m *testing.M) {
	os.Exit(testdb.RunTests(m))
}
