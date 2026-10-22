package insights

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/middleware"
)

// CleanupAudit bounds one maintenance cycle to ten seconds and at most two thousand expired rows.
func (s *Service) CleanupAudit(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	queries := sqlc.New(s.pool)
	for range 4 {
		count, err := queries.DeleteExpiredAuditLogs(ctx)
		if err != nil {
			return err
		}
		if count < 500 {
			return nil
		}
	}
	return nil
}

// RunAuditCleanup performs independent retention work until application shutdown cancels it.
func (s *Service) RunAuditCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	if interval <= 0 {
		logger.ErrorContext(ctx, "audit_cleanup_failed", "error_category", "invalid_interval", "request_id", middleware.RequestIDFromContext(ctx))
		return
	}
	run := func() {
		if err := s.CleanupAudit(ctx); err != nil && !errors.Is(err, context.Canceled) {
			logger.ErrorContext(ctx, "audit_cleanup_failed", "error_category", "database", "request_id", middleware.RequestIDFromContext(ctx))
		}
	}
	run()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			run()
		}
	}
}
