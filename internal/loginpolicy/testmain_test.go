package loginpolicy_test

import (
	"os"
	"testing"

	"github.com/TomyJan/MoeURL/internal/testdb"
)

// TestMain releases this package's shared PostgreSQL even when Ryuk is disabled.
func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }
