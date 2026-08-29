package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	nethttp "net/http"
	"sync"
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
	"github.com/TomyJan/MoeURL/internal/usergroup"
	"github.com/jackc/pgx/v5/pgxpool"
)

const accessGrantCleanupInterval = time.Minute

// validatePermissionCatalog allows startup validation failures to be exercised without mutating package catalog state.
var validatePermissionCatalog = permission.ValidateCatalog

// App owns the HTTP server, database Pool, and process-scoped background work.
type App struct {
	config           config.Config
	logger           *slog.Logger
	server           *nethttp.Server
	pool             *pgxpool.Pool
	backgroundCancel context.CancelFunc
	backgroundDone   <-chan struct{}
	shutdownOnce     sync.Once
	shutdownErr      error
	shutdownHTTP     func(context.Context) error
	closePool        func()
}

// New builds the application dependencies and HTTP server from configuration.
func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	if err := validatePermissionCatalog(); err != nil {
		return nil, fmt.Errorf("validate permission catalog: %w", err)
	}
	setupPolicy, err := system.NewSetupPolicy(cfg.Env == "production", cfg.SetupToken)
	if err != nil {
		return nil, fmt.Errorf("validate setup policy: %w", err)
	}
	var pool *pgxpool.Pool
	deps := apphttp.Dependencies{Logger: logger}
	var backgroundCancel context.CancelFunc
	var backgroundDone <-chan struct{}
	if cfg.DatabaseURL != "" {
		pool, err = appdb.OpenPool(ctx, cfg.DatabaseURL)
		if err != nil {
			return nil, err
		}
		deps.Health = pool
		deps.System = system.NewService(pool, setupPolicy)
		authService := auth.NewService(pool, 24*time.Hour)
		deps.Auth = authService
		deps.CurrentUser = authService
		permissionService := permission.NewDatabaseService(pool)
		deps.ShortLink = shortlink.NewServiceWithLogger(pool, permissionService, logger)
		recorder := event.NewRecorder(pool, logger)
		redirectService := shortlink.NewRedirectService(pool, recorder)
		deps.Redirect = redirectService
		deps.RedirectRecorder = recorder
		deps.AnalyticsCountryHeader = cfg.AnalyticsCountryHeader
		deps.SecureCookies = cfg.Env == "production"
		deps.User = user.NewService(pool, permissionService)
		deps.UserGroup = usergroup.NewService(pool, permissionService)

		backgroundCancel, backgroundDone = startBackgroundTasks(
			func(ctx context.Context) {
				redirectService.RunAccessGrantCleanup(ctx, accessGrantCleanupInterval, logger)
			},
		)
	}
	deps.StaticDir = cfg.StaticDir

	return &App{
		config: cfg,
		logger: logger,
		server: &nethttp.Server{
			Addr:              cfg.HTTPAddr,
			Handler:           apphttp.NewRouter(deps),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       15 * time.Second,
			WriteTimeout:      30 * time.Second,
			IdleTimeout:       60 * time.Second,
			MaxHeaderBytes:    1 << 20,
		},
		pool:             pool,
		backgroundCancel: backgroundCancel,
		backgroundDone:   backgroundDone,
	}, nil
}

// startBackgroundTasks runs process-scoped tasks under one cancellation and completion boundary.
func startBackgroundTasks(tasks ...func(context.Context)) (context.CancelFunc, <-chan struct{}) {
	ctx, cancel := context.WithCancel(context.Background())
	var tasksWaitGroup sync.WaitGroup
	for _, task := range tasks {
		tasksWaitGroup.Add(1)
		go func(task func(context.Context)) {
			defer tasksWaitGroup.Done()
			task(ctx)
		}(task)
	}
	done := make(chan struct{})
	go func() {
		tasksWaitGroup.Wait()
		close(done)
	}()
	return cancel, done
}

// Run starts the configured HTTP server.
func (a *App) Run() error {
	a.logger.Info("server_starting", "addr", a.config.HTTPAddr)
	return a.server.ListenAndServe()
}

// Shutdown drains HTTP traffic, stops background work, and closes the database Pool exactly once.
func (a *App) Shutdown(ctx context.Context) error {
	a.shutdownOnce.Do(func() {
		var shutdownErrors []error
		if err := a.shutdownHTTPServer(ctx); err != nil {
			shutdownErrors = append(shutdownErrors, fmt.Errorf("shutdown HTTP server: %w", err))
		}
		if a.backgroundCancel != nil {
			a.backgroundCancel()
		}
		if err := waitForBackgroundTasks(ctx, a.backgroundDone); err != nil {
			shutdownErrors = append(shutdownErrors, fmt.Errorf("wait for background tasks: %w", err))
		}
		a.closeDatabasePool()
		a.shutdownErr = errors.Join(shutdownErrors...)
	})
	return a.shutdownErr
}

// shutdownHTTPServer invokes the lifecycle hook or drains the concrete HTTP server when present.
func (a *App) shutdownHTTPServer(ctx context.Context) error {
	if a.shutdownHTTP != nil {
		return a.shutdownHTTP(ctx)
	}
	if a.server == nil {
		return nil
	}
	return a.server.Shutdown(ctx)
}

// waitForBackgroundTasks waits for group completion while preferring an already completed group over Context cancellation.
func waitForBackgroundTasks(ctx context.Context, done <-chan struct{}) error {
	if done == nil {
		return nil
	}
	select {
	case <-done:
		return nil
	default:
	}
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		select {
		case <-done:
			return nil
		default:
			return ctx.Err()
		}
	}
}

// closeDatabasePool invokes the lifecycle hook or closes the concrete Pool when present.
func (a *App) closeDatabasePool() {
	if a.closePool != nil {
		a.closePool()
		return
	}
	if a.pool != nil {
		a.pool.Close()
	}
}
