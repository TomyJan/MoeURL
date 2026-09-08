package http

import (
	"log/slog"
	nethttp "net/http"
	"os"
	"path/filepath"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/TomyJan/MoeURL/internal/usergroup"
	"github.com/go-chi/chi/v5"
)

type Dependencies struct {
	Logger                 *slog.Logger
	Health                 HealthChecker
	System                 system.ServicePort
	Auth                   auth.Port
	CurrentUser            auth.CurrentUserResolver
	ShortLink              shortlink.Port
	Redirect               shortlink.RedirectPort
	RedirectRecorder       event.Recorder
	AnalyticsCountryHeader string
	SecureCookies          bool
	User                   user.Port
	UserGroup              usergroup.Port
	StaticDir              string
}

// NewRouter registers API, static-file, and short-link redirect routes.
func NewRouter(deps ...Dependencies) nethttp.Handler {
	var dependency Dependencies
	if len(deps) > 0 {
		dependency = deps[0]
	}

	logger := dependency.Logger
	if logger == nil {
		logger = slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.Recovery(logger))
	router.Use(middleware.SecurityHeaders)
	router.Use(middleware.RequestLogger(logger))
	router.Use(middleware.BodyLimit)
	var redirectHandler *shortlink.RedirectHandler
	if dependency.Redirect != nil {
		redirectHandler = shortlink.NewRedirectHandlerWithAnalyticsAndSecurity(dependency.Redirect, dependency.RedirectRecorder, dependency.AnalyticsCountryHeader, dependency.SecureCookies, logger)
	}

	router.Route("/api/v1", func(api chi.Router) {
		healthHandler := NewHealthHandler(dependency.Health, logger)
		api.Get("/health/live", healthHandler.Live)
		api.Get("/health/ready", healthHandler.Ready)
		api.Get("/health", healthHandler.Ready)

		api.Group(func(businessAPI chi.Router) {
			businessAPI.Use(middleware.NoStore)
			businessAPI.Use(auth.CurrentUserMiddlewareWithLogger(dependency.CurrentUser, logger))
			if dependency.System != nil {
				systemHandler := system.NewHandlerWithLogger(dependency.System, logger)
				businessAPI.Get("/init/status", systemHandler.Status)
				businessAPI.Post("/init/setup", systemHandler.Setup)
			}
			if dependency.Auth != nil {
				authHandler := auth.NewHandlerWithLogger(dependency.Auth, dependency.SecureCookies, logger)
				businessAPI.Post("/auth/login", authHandler.Login)
				businessAPI.Post("/auth/logout", authHandler.Logout)
				businessAPI.Get("/auth/me", authHandler.Me)
			}
			if dependency.ShortLink != nil {
				shortLinkHandler := shortlink.NewHandlerWithLogger(dependency.ShortLink, logger)
				businessAPI.Post("/short-link/create", shortLinkHandler.Create)
				businessAPI.Get("/short-link/overview", shortLinkHandler.Overview)
				businessAPI.Get("/short-link/list", shortLinkHandler.List)
				businessAPI.Get("/short-link/statistics", shortLinkHandler.Statistics)
				businessAPI.Post("/short-link/update", shortLinkHandler.Update)
				businessAPI.Post("/short-link/delete", shortLinkHandler.Delete)
				businessAPI.Get("/admin/short-link/list", shortLinkHandler.AdminList)
				businessAPI.Get("/admin/short-link/statistics", shortLinkHandler.AdminStatistics)
				businessAPI.Post("/admin/short-link/update", shortLinkHandler.AdminUpdate)
				businessAPI.Post("/admin/short-link/delete", shortLinkHandler.AdminDelete)
			}
			if redirectHandler != nil {
				businessAPI.Get("/public/short-link/preview", redirectHandler.PreviewPublic)
			}
			if dependency.User != nil {
				userHandler := user.NewHandlerWithLogger(dependency.User, logger)
				businessAPI.Post("/admin/user/create", userHandler.Create)
				businessAPI.Get("/admin/user/list", userHandler.List)
				businessAPI.Post("/admin/user/update", userHandler.Update)
				businessAPI.Post("/user/profile/update", userHandler.UpdateProfile)
				businessAPI.Post("/admin/user/reset-password", userHandler.ResetPassword)
			}
			if dependency.UserGroup != nil {
				userGroupHandler := usergroup.NewHandler(dependency.UserGroup, logger)
				businessAPI.Get("/admin/user-group/list", userGroupHandler.List)
				businessAPI.Post("/admin/user-group/update-permissions", userGroupHandler.UpdatePermissions)
			}

			businessAPI.NotFound(func(w nethttp.ResponseWriter, r *nethttp.Request) {
				BusinessError(w, CodeInvalidRequest, "API not found")
			})
		})
	})

	router.Group(func(business chi.Router) {
		business.Use(auth.CurrentUserMiddlewareWithLogger(dependency.CurrentUser, logger))
		if redirectHandler != nil {
			business.Post("/go/{slug}/unlock", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.Unlock(w, r, chi.URLParam(r, "slug"))
			})
			business.Get("/go/{slug}/continue", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.Continue(w, r, chi.URLParam(r, "slug"))
			})
			business.Get("/go/{slug}/preview", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.PreviewScoped(w, r, chi.URLParam(r, "slug"))
			})
		}
		if dependency.StaticDir != "" {
			registerStaticRoutes(business, dependency.StaticDir)
		}
		if redirectHandler != nil {
			business.Get("/{slug}", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.Open(w, r, chi.URLParam(r, "slug"))
			})
		}
	})

	return router
}

// registerStaticRoutes serves the web application assets and client routes.
func registerStaticRoutes(router chi.Router, staticDir string) {
	fileServer := nethttp.FileServer(nethttp.Dir(staticDir))
	router.Handle("/assets/*", fileServer)
	router.Handle("/icons/*", fileServer)
	router.Get("/manifest.webmanifest", serveStaticFile(staticDir, "manifest.webmanifest"))
	router.Get("/sw.js", serveStaticFile(staticDir, "sw.js"))
	for _, path := range []string{
		"/",
		"/setup",
		"/login",
		"/profile",
		"/console",
		"/link",
		"/analytics",
		"/admin/link",
		"/admin/user",
		"/admin/user/group",
		"/admin/setting",
		"/admin/user/new",
	} {
		router.Get(path, serveStaticFile(staticDir, "index.html"))
	}
	router.Get("/go/{slug}", serveStaticFile(staticDir, "index.html"))
}

// serveStaticFile returns a handler for a file within the static directory.
func serveStaticFile(staticDir string, name string) nethttp.HandlerFunc {
	return func(w nethttp.ResponseWriter, r *nethttp.Request) {
		nethttp.ServeFile(w, r, filepath.Join(staticDir, name))
	}
}
