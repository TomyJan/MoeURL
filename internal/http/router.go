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
	"github.com/go-chi/chi/v5"
)

type Dependencies struct {
	System                 system.ServicePort
	Auth                   auth.Port
	CurrentUser            auth.CurrentUserResolver
	ShortLink              shortlink.Port
	Redirect               shortlink.RedirectPort
	RedirectRecorder       event.Recorder
	AnalyticsCountryHeader string
	User                   user.Port
	StaticDir              string
}

// NewRouter registers API, static-file, and short-link redirect routes.
func NewRouter(deps ...Dependencies) nethttp.Handler {
	var dependency Dependencies
	if len(deps) > 0 {
		dependency = deps[0]
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	router := chi.NewRouter()
	router.Use(middleware.RequestLogger(logger))
	router.Use(auth.CurrentUserMiddleware(dependency.CurrentUser))

	router.Route("/api/v1", func(api chi.Router) {
		api.Get("/health", func(w nethttp.ResponseWriter, r *nethttp.Request) {
			OK(w, map[string]string{"status": "ok"})
		})

		if dependency.System != nil {
			systemHandler := system.NewHandler(dependency.System)
			api.Get("/init/status", systemHandler.Status)
			api.Post("/init/setup", systemHandler.Setup)
		}
		if dependency.Auth != nil {
			authHandler := auth.NewHandler(dependency.Auth)
			api.Post("/auth/login", authHandler.Login)
			api.Post("/auth/logout", authHandler.Logout)
			api.Get("/auth/me", authHandler.Me)
		}
		if dependency.ShortLink != nil {
			shortLinkHandler := shortlink.NewHandler(dependency.ShortLink)
			api.Post("/short-link/create", shortLinkHandler.Create)
			api.Get("/short-link/list", shortLinkHandler.List)
			api.Post("/short-link/update", shortLinkHandler.Update)
			api.Post("/short-link/delete", shortLinkHandler.Delete)
			api.Get("/admin/short-link/list", shortLinkHandler.AdminList)
			api.Post("/admin/short-link/update", shortLinkHandler.AdminUpdate)
			api.Post("/admin/short-link/delete", shortLinkHandler.AdminDelete)
		}
		if dependency.User != nil {
			userHandler := user.NewHandler(dependency.User)
			api.Post("/admin/user/create", userHandler.Create)
			api.Get("/admin/user/list", userHandler.List)
			api.Post("/admin/user/update", userHandler.Update)
			api.Post("/admin/user/reset-password", userHandler.ResetPassword)
		}

		api.NotFound(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			BusinessError(w, CodeInvalidRequest, "API not found")
		})
	})

	if dependency.StaticDir != "" {
		registerStaticRoutes(router, dependency.StaticDir)
	}
	if dependency.Redirect != nil {
		redirectHandler := shortlink.NewRedirectHandlerWithAnalytics(dependency.Redirect, dependency.RedirectRecorder, dependency.AnalyticsCountryHeader)
		router.Get("/{slug}", func(w nethttp.ResponseWriter, r *nethttp.Request) {
			redirectHandler.Open(w, r, chi.URLParam(r, "slug"))
		})
	}

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
}

// serveStaticFile returns a handler for a file within the static directory.
func serveStaticFile(staticDir string, name string) nethttp.HandlerFunc {
	return func(w nethttp.ResponseWriter, r *nethttp.Request) {
		nethttp.ServeFile(w, r, filepath.Join(staticDir, name))
	}
}
