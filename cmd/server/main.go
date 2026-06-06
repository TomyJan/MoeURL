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

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	application, err := app.New(context.Background(), config.Load(), logger)
	if err != nil {
		logger.Error("app_initialization_failed", "error", err)
		os.Exit(1)
	}

	if err := application.Run(); err != nil && !errors.Is(err, nethttp.ErrServerClosed) {
		logger.Error("server_stopped", "error", err)
		os.Exit(1)
	}
}
