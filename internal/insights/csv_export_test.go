package insights

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/stretchr/testify/require"
)

// TestAuditExportEncodingCancellation catches encoding after cancellation and sentinel rows escaping.
func TestAuditExportEncodingCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := auditExportCSV(ctx, Range{}, []sqlc.ExportAuditLogsRow{{ID: "1"}})
	require.ErrorIs(t, err, context.Canceled)
	require.Empty(t, result.Content)
	result, err = auditExportCSV(t.Context(), Range{}, []sqlc.ExportAuditLogsRow{{}})
	require.NoError(t, err)
	require.Equal(t, "\ufeffstart_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields\r\n", result.Content)
}
