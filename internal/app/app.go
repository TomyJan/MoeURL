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

const accessGrantCleanupInterval = time.Minute

type App struct {
	config             config.Config
	logger             *slog.Logger
	server             *nethttp.Server
	pool               *pgxpool.Pool
	grantCleanupCancel context.CancelFunc
	grantCleanupDone   <-chan struct{}
}

// New builds the application dependencies and HTTP server from configuration.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	var pool *pgxpool.Pool
	var deps apphttp.Dependencies
	var grantCleanupCancel context.CancelFunc
	var grantCleanupDone <-chan struct{}
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
		redirectService := shortlink.NewRedirectService(pool, recorder)
		deps.Redirect = redirectService
		deps.RedirectRecorder = recorder
		deps.AnalyticsCountryHeader = cfg.AnalyticsCountryHeader
		deps.SecureCookies = cfg.Env == "production"
		deps.User = user.NewService(pool, permission.NewService())

		cleanupContext, cancelCleanup := context.WithCancel(context.Background())
		cleanupDone := make(chan struct{})
		grantCleanupCancel = cancelCleanup
		grantCleanupDone = cleanupDone
		go func() {
			defer close(cleanupDone)
			redirectService.RunAccessGrantCleanup(cleanupContext, accessGrantCleanupInterval, logger)
		}()
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
		pool:               pool,
		grantCleanupCancel: grantCleanupCancel,
		grantCleanupDone:   grantCleanupDone,
	}, nil
}

// Run starts the configured HTTP server.
func (a *App) Run() error {
	a.logger.Info("server_starting", "addr", a.config.HTTPAddr)
	return a.server.ListenAndServe()
}

// Shutdown closes database resources and gracefully stops the HTTP server.
func (a *App) Shutdown(ctx context.Context) error {
	if err := a.server.Shutdown(ctx); err != nil {
		return err
	}
	if a.grantCleanupCancel != nil {
		a.grantCleanupCancel()
		<-a.grantCleanupDone
	}
	if a.pool != nil {
		a.pool.Close()
	}
	return nil
}
