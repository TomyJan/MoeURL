package oidc

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

type loginAttemptCleanupStore interface {
	DeleteExpiredOIDCLoginAttempts(context.Context, int32) (int64, error)
}

// RunLoginAttemptCleanup removes expired one-time attempts immediately and periodically until cancellation.
func (s *LoginService) RunLoginAttemptCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	if logger == nil {
		logger = slog.Default()
	}
	if interval <= 0 {
		logger.ErrorContext(ctx, "oidc_login_attempt_cleanup_failed", "error_category", "invalid_interval")
		return
	}
	cleanupStore, ok := s.store.(loginAttemptCleanupStore)
	if !ok {
		logger.ErrorContext(ctx, "oidc_login_attempt_cleanup_failed", "error_category", "database_unavailable")
		return
	}
	run := func() {
		if err := runLoginAttemptCleanupCycle(ctx, cleanupStore.DeleteExpiredOIDCLoginAttempts); err != nil && !errors.Is(err, context.Canceled) {
			logger.ErrorContext(ctx, "oidc_login_attempt_cleanup_failed", "error_type", "database")
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

// runLoginAttemptCleanupCycle deletes a bounded number of expired-attempt batches.
func runLoginAttemptCleanupCycle(ctx context.Context, cleanup func(context.Context, int32) (int64, error)) error {
	for range maxLoginAttemptCleanupBatches {
		deleted, err := cleanup(ctx, loginAttemptCleanupBatchSize)
		if err != nil {
			return err
		}
		if deleted < int64(loginAttemptCleanupBatchSize) {
			return nil
		}
	}
	return nil
}
