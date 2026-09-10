package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/TomyJan/MoeURL/internal/app"
	"github.com/TomyJan/MoeURL/internal/config"
)

const serverShutdownTimeout = 15 * time.Second

// serverApplication is the lifecycle surface required by the process entrypoint.
type serverApplication interface {
	Run() error
	Shutdown(context.Context) error
}

// applicationFactory builds the lifecycle surface from validated configuration.
type applicationFactory func(context.Context, config.Config, *slog.Logger) (serverApplication, error)

// notifyContextFunc creates a context canceled by one of the supplied operating-system signals.
type notifyContextFunc func(context.Context, ...os.Signal) (context.Context, context.CancelFunc)

// main loads configuration and starts the application server.
func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(context.Background(), config.Load(), logger, newApplication, signal.NotifyContext); err != nil {
		os.Exit(1)
	}
}

// newApplication constructs the concrete application behind the process lifecycle interface.
func newApplication(ctx context.Context, cfg config.Config, logger *slog.Logger) (serverApplication, error) {
	return app.New(ctx, cfg, logger)
}

// run owns signal subscription, server execution, and the bounded application shutdown sequence.
func run(
	parent context.Context,
	cfg config.Config,
	logger *slog.Logger,
	newApp applicationFactory,
	notifyContext notifyContextFunc,
) error {
	return runWithShutdownTimeout(parent, cfg, logger, newApp, notifyContext, serverShutdownTimeout)
}

// runWithShutdownTimeout executes run with an explicit graceful-shutdown deadline for deterministic lifecycle tests.
func runWithShutdownTimeout(
	parent context.Context,
	cfg config.Config,
	logger *slog.Logger,
	newApp applicationFactory,
	notifyContext notifyContextFunc,
	shutdownTimeout time.Duration,
) error {
	if err := cfg.Validate(); err != nil {
		logger.Error("invalid_config", "error", err)
		return err
	}

	lifecycleContext, stopSignals := notifyContext(parent, os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	application, err := newApp(lifecycleContext, cfg, logger)
	if err != nil {
		logger.Error("app_initialization_failed", "error", err)
		return err
	}

	serverResult := make(chan error, 1)
	go func() {
		serverResult <- application.Run()
	}()

	var runErr error
	serverExitedBeforeShutdown := false
	select {
	case runErr = <-serverResult:
		serverExitedBeforeShutdown = true
	case <-lifecycleContext.Done():
	}
	if serverExitedBeforeShutdown && runErr == nil {
		runErr = errors.New("HTTP server stopped unexpectedly")
	}

	shutdownContext, cancelShutdown := context.WithTimeout(context.WithoutCancel(parent), shutdownTimeout)
	defer cancelShutdown()
	shutdownResult := make(chan error, 1)
	go func() {
		shutdownResult <- application.Shutdown(shutdownContext)
	}()
	shutdownErr := waitForShutdownResult(shutdownContext, shutdownResult)
	if !serverExitedBeforeShutdown && shutdownErr == nil {
		var serverWaitErr error
		runErr, serverWaitErr = waitForServerResult(shutdownContext, serverResult)
		shutdownErr = serverWaitErr
	}

	if runErr != nil && (serverExitedBeforeShutdown || !errors.Is(runErr, nethttp.ErrServerClosed)) {
		logger.Error("server_stopped", "error", runErr)
	} else {
		runErr = nil
	}
	if shutdownErr != nil {
		logger.Error("server_shutdown_failed", "error", shutdownErr)
	} else {
		logger.Info("server_shutdown_complete")
	}
	return errors.Join(runErr, shutdownErr)
}

// waitForShutdownResult bounds dependency shutdown and prefers an already completed result over Context cancellation.
func waitForShutdownResult(ctx context.Context, result <-chan error) error {
	select {
	case err := <-result:
		return err
	default:
	}
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		select {
		case err := <-result:
			return err
		default:
			return fmt.Errorf("wait for application shutdown: %w", ctx.Err())
		}
	}
}

// waitForServerResult bounds Server completion and distinguishes a Server error from a wait failure.
func waitForServerResult(ctx context.Context, result <-chan error) (error, error) {
	select {
	case err := <-result:
		return err, nil
	default:
	}
	select {
	case err := <-result:
		return err, nil
	case <-ctx.Done():
		select {
		case err := <-result:
			return err, nil
		default:
			return nil, fmt.Errorf("wait for HTTP server to stop: %w", ctx.Err())
		}
	}
}
