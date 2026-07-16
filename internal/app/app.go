package app

import (
	"context"
	"log/slog"
	nethttp "net/http"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/config"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/event"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	config config.Config
	logger *slog.Logger
	server *nethttp.Server
	pool   *pgxpool.Pool
}

// New implements package-specific behavior.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	var pool *pgxpool.Pool
	var deps apphttp.Dependencies
	if cfg.DatabaseURL != "" {
		var err error
		pool, err = appdb.OpenPool(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, err
		}
		deps.System = system.NewService(pool)
		authService := auth.NewService(pool, 24*time.Hour)
		deps.Auth = authService
		deps.CurrentUser = authService
		deps.ShortLink = shortlink.NewService(pool, permission.NewService())
		recorder := event.NewRecorder(pool, logger)
		deps.Redirect = shortlink.NewRedirectService(pool, recorder)
		deps.RedirectRecorder = recorder
		deps.User = user.NewService(pool, permission.NewService())
	}
	deps.StaticDir = cfg.StaticDir

	return &App{
		config: cfg,
		logger: logger,
		server: &nethttp.Server{
			Addr:              cfg.HTTPAddr,
			Handler:           apphttp.NewRouter(deps),
			ReadHeaderTimeout: 5 * time.Second,
		},
		pool: pool,
	}, nil
}

// Run implements package-specific behavior.
func (a *App) Run() error {
	a.logger.Info("server_starting", "addr", a.config.HTTPAddr)
	return a.server.ListenAndServe()
}

// Shutdown implements package-specific behavior.
func (a *App) Shutdown(ctx context.Context) error {
	if a.pool != nil {
		a.pool.Close()
	}
	return a.server.Shutdown(ctx)
}
