package http

import (
	"context"
	"errors"
	"log/slog"
	nethttp "net/http"
	"time"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

const readinessTimeout = 2 * time.Second

var errHealthDependencyUnavailable = errors.New("health dependency unavailable")

// HealthChecker is the minimal dependency required to determine readiness.
type HealthChecker interface {
	Ping(context.Context) error
}

// HealthHandler serves public liveness and readiness checks.
type HealthHandler struct {
	checker HealthChecker
	logger  *slog.Logger
	timeout time.Duration
}

// NewHealthHandler creates health checks with the production readiness timeout.
func NewHealthHandler(checker HealthChecker, logger *slog.Logger) *HealthHandler {
	return newHealthHandler(checker, logger, readinessTimeout)
}

// newHealthHandler injects a bounded readiness timeout and a safe logger fallback.
func newHealthHandler(checker HealthChecker, logger *slog.Logger, timeout time.Duration) *HealthHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return &HealthHandler{checker: checker, logger: logger, timeout: timeout}
}

// Live reports whether the HTTP router can process requests without probing dependencies.
func (handler *HealthHandler) Live(w nethttp.ResponseWriter, _ *nethttp.Request) {
	OK(w, map[string]string{"status": "ok"})
}

// Ready reports whether the database dependency is reachable within a bounded timeout.
func (handler *HealthHandler) Ready(w nethttp.ResponseWriter, r *nethttp.Request) {
	err := errHealthDependencyUnavailable
	if handler.checker != nil {
		ctx, cancel := context.WithTimeout(r.Context(), handler.timeout)
		defer cancel()
		err = handler.checker.Ping(ctx)
	}
	if err == nil {
		OK(w, map[string]string{"status": "ok"})
		return
	}

	handler.logger.ErrorContext(r.Context(), "database_readiness_failed",
		"request_id", middleware.RequestIDFromContext(r.Context()),
		"error_category", readinessErrorCategory(err),
	)
	WriteJSON(w, nethttp.StatusServiceUnavailable, Response{
		Code:    900000,
		Message: "Service unavailable",
		Data:    map[string]string{"status": "unavailable"},
		Meta:    nil,
	})
}

// readinessErrorCategory maps dependency failures to stable, non-sensitive log categories.
func readinessErrorCategory(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "timeout"
	}
	return "dependency"
}
