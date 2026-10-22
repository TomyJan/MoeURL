package insights_test

import (
	"encoding/base64"
	"testing"

	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/stretchr/testify/require"
)

// TestAuditHTTP rejects ambiguous filters and hides database diagnostic values behind the private envelope.
func TestAuditHTTP(t *testing.T) {
	pool, service, owner, admin, _, _ := fixture(t)
	requestInsight(t, service, admin, "/api/v1/admin/audit/list", 200, 0)
	requestInsight(t, service, owner, "/api/v1/admin/audit/list", 200, 120001)
	for _, query := range []string{"bad=x", "days=", "days=7&days=30", "pageSize=0", "pageSize=101", "pageSize=01", "pageSize=x", "%xx=x", "actorId=bad", "resourceType=secret", "action=login", "days=8", "cursor=bad", "startDate=2026-01-01", "days=7&pageSize=2&actorId=not-a-uuid"} {
		requestInsight(t, service, admin, "/api/v1/admin/audit/list?"+query, 200, 100001)
	}
	requestInsight(t, service, admin, "/api/v1/admin/audit/list?days=7&pageSize=2&actorId="+owner.ID+"&resourceType=user&action=update", 200, 0)
	for _, id := range []string{"0", "-1", "9223372036854775808", "1.1", "+1"} {
		cursor := base64.RawURLEncoding.EncodeToString([]byte(`{"id":"` + id + `","createdAt":"2026-01-01T00:00:00Z"}`))
		_, err := service.Audit(t.Context(), admin, insights.AuditInput{Cursor: cursor})
		require.ErrorIs(t, err, insights.ErrInvalidInput)
	}
	_, err := pool.Exec(t.Context(), `drop table audit_log cascade`)
	require.NoError(t, err)
	body := requestInsight(t, service, admin, "/api/v1/admin/audit/list", 500, 900000)
	require.NotContains(t, string(body), "audit_log")
}
