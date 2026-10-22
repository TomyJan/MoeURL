package insights_test

import (
	"bytes"
	"context"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/stretchr/testify/require"
	"log/slog"
	"strings"
	"testing"
	"time"
)

// TestAuditRetentionCycle verifies the production batch limit against real expired rows, including rollback on failure.
func TestAuditRetentionCycle(t *testing.T) {
	pool, service, _, _, _, _ := fixture(t)
	cleaner, ok := any(service).(interface{ CleanupAudit(context.Context) error })
	require.True(t, ok, "audit retention cycle must be implemented")
	ctx := t.Context()
	_, err := pool.Exec(ctx, `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) select 'user',x::text,'update',array['nickname'],now()-interval '181 days' from generate_series(1,2100) x; insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','keep','update',array['nickname'],now()-interval '179 days')`)
	require.NoError(t, err)
	require.NoError(t, cleaner.CleanupAudit(ctx))
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 101, count)
	_, err = pool.Exec(ctx, `create function reject_audit_delete() returns trigger language plpgsql as $$ begin raise exception 'private failure'; end $$; create trigger reject_audit_delete before delete on audit_log for each row execute function reject_audit_delete()`)
	require.NoError(t, err)
	require.Error(t, cleaner.CleanupAudit(ctx))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 101, count)
	_, err = pool.Exec(ctx, `drop trigger reject_audit_delete on audit_log`)
	require.NoError(t, err)
	require.NoError(t, cleaner.CleanupAudit(ctx))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	require.Error(t, cleaner.CleanupAudit(canceled))
}

// TestAuditCleanupLifecycle verifies early stop, periodic scheduling, bounded waits, cancellation and diagnostic redaction.
func TestAuditCleanupLifecycle(t *testing.T) {
	pool, _, _, _, _, _ := fixture(t)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	queries := 0
	tracked := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, query string) context.Context {
		if strings.Contains(query, "DeleteExpiredAuditLogs") {
			queries++
			if queries == 2 {
				cancel()
			}
		}
		return ctx
	}})
	service := insights.NewService(tracked, permission.NewDatabaseService(tracked))
	service.RunAuditCleanup(ctx, time.Millisecond, nil)
	require.Equal(t, 2, queries, "empty cycles should issue one batch each")
	var output bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&output, nil))
	service.RunAuditCleanup(t.Context(), 0, logger)
	require.Contains(t, output.String(), "invalid_interval")
	output.Reset()
	_, err := pool.Exec(t.Context(), `drop table audit_log cascade`)
	require.NoError(t, err)
	failed, cancelFailed := context.WithCancel(t.Context())
	defer cancelFailed()
	logger = slog.New(slog.NewTextHandler(auditLogCancelWriter{&output, cancelFailed}, nil))
	insights.NewService(pool, nil).RunAuditCleanup(failed, time.Hour, logger)
	require.Contains(t, output.String(), "error_category=database")
	require.NotContains(t, output.String(), "does not exist")
}

type auditLogCancelWriter struct {
	buffer *bytes.Buffer
	cancel context.CancelFunc
}

// Write ends the background loop after its actual error has been logged, without timing assumptions.
func (w auditLogCancelWriter) Write(data []byte) (int, error) {
	n, err := w.buffer.Write(data)
	w.cancel()
	return n, err
}

// TestAuditCleanupDeadline proves blocked maintenance exits on its own ten-second cycle budget.
func TestAuditCleanupDeadline(t *testing.T) {
	pool, service, _, _, _, _ := fixture(t)
	ctx := t.Context()
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `lock table audit_log in access exclusive mode`)
	require.NoError(t, err)
	started := time.Now()
	require.Error(t, service.CleanupAudit(ctx))
	require.GreaterOrEqual(t, time.Since(started), 9*time.Second)
	require.Less(t, time.Since(started), 15*time.Second)
}
