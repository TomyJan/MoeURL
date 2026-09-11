package oidc

import (
	"os"
	"testing"

	"github.com/TomyJan/MoeURL/internal/testdb"
)

func TestMain(m *testing.M) {
	os.Exit(testdb.RunTests(m))
}
