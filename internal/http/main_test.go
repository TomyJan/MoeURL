package http_test

import (
	"os"
	"testing"

	"github.com/TomyJan/MoeURL/internal/testdb"
)

// TestMain keeps all router database tests alive until their own pool/database cleanups finish.
func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }
