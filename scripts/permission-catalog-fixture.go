//go:build ignore

package main

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/TomyJan/MoeURL/internal/permission"
)

// main emits the live backend permission catalog for cross-layer contract tests.
// Regenerate the checked-in fixture after catalog changes with:
// go run ./scripts/permission-catalog-fixture.go > web/src/test/fixtures/permission-catalog.json
func main() {
	if err := json.NewEncoder(os.Stdout).Encode(permission.Definitions()); err != nil {
		fmt.Fprintf(os.Stderr, "encode permission catalog: %v\n", err)
		os.Exit(1)
	}
}
