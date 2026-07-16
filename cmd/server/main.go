package main

import (
	"context"
	"errors"
	"log/slog"
	nethttp "net/http"
	"os"

	"github.com/TomyJan/MoeURL/internal/app"
	"github.com/TomyJan/MoeURL/internal/config"
)

// main implements package-specific behavior.
func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg := config.Load()
	if err := cfg.Validate(); err != nil {
		logger.Error("invalid_config", "error", err)
		os.Exit(1)
	}

	application, err := app.New(context.Background(), cfg, logger)
	if err != nil {
		logger.Error("app_initialization_failed", "error", err)
		os.Exit(1)
	}

	if err := application.Run(); err != nil && !errors.Is(err, nethttp.ErrServerClosed) {
		logger.Error("server_stopped", "error", err)
		os.Exit(1)
	}
}
