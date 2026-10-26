package insights

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/stretchr/testify/require"
)

// TestVisitExportEncodingCancellation prevents CPU encoding from ignoring a canceled snapshot.
func TestVisitExportEncodingCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := visitExportCSV(ctx, "id", Range{}, []sqlc.ExportInsightVisitsRow{{ID: "event"}})
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, result.Content)
}
