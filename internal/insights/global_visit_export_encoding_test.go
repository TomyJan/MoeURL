package insights

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/stretchr/testify/require"
)

// TestGlobalVisitExportEncodingCancellation prevents CPU encoding from ignoring a canceled snapshot.
func TestGlobalVisitExportEncodingCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := globalVisitExportCSV(ctx, Range{}, []sqlc.ExportGlobalInsightVisitsRow{{ID: "event", ShortLinkID: "link"}})
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, result.Content)
}
