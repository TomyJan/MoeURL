package http

import (
	"log/slog"
	nethttp "net/http"
	"os"
	"path/filepath"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/TomyJan/MoeURL/internal/oidc"
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
	SystemSettings         system.SettingsPort
	HomeContent            system.HomeContentPort
	Appearance             system.AppearancePort
	FooterLinks            system.FooterLinksPort
	Auth                   auth.Port
	Password               auth.PasswordPort
	CurrentUser            auth.CurrentUserResolver
	ShortLink              shortlink.Port
	ShortLinkExport        shortlink.ExportPort
	ShortLinkListExport    shortlink.ListExportPort
	ShortLinkBatch         shortlink.BatchPort
	ShortLinkTransfer      shortlink.TransferPort
	ShortLinkBatchTransfer shortlink.BatchTransferPort
	ShortLinkBatchTags     shortlink.BatchTagsPort
	Insights               insights.Port
	VisitExport            insights.VisitExportPort
	Audit                  insights.AuditPort
	AuditExport            insights.AuditExportPort
	Domain                 domain.Port
	DomainOrder            domain.OrderPort
	DomainRedirectDefault  domain.RedirectDefaultPort
	Redirect               shortlink.RedirectPort
	RedirectRecorder       event.Recorder
	AnalyticsCountryHeader string
	SecureCookies          bool
	User                   user.Port
	UserMembership         user.GroupPort
	UserBatchMembership    user.BatchGroupPort
	UserPreferences        user.PreferencesPort
	UserDomainPreference   user.DomainPreferencePort
	UserTimeZonePreference user.TimeZonePreferencePort
	UserGroup              usergroup.Port
	UserGroupDomainDefault usergroup.DomainDefaultPort
	OIDCProvider           oidc.ProviderPort
	OIDCLogin              oidc.LoginPort
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
		if dependency.Password != nil {
			passwordHandler := auth.NewPasswordHandler(dependency.Password, dependency.SecureCookies, logger)
			api.With(middleware.NoStore).Get("/auth/password/status", passwordHandler.Status)
			api.With(middleware.NoStore).Post("/auth/password/change", passwordHandler.Change)
		}
		if dependency.SystemSettings != nil {
			settingsHandler := system.NewSettingsHandler(dependency.SystemSettings, logger)
			api.With(middleware.NoStore).Get("/system/public-config", settingsHandler.PublicConfig)
		}
		if dependency.HomeContent != nil {
			homeContentHandler := system.NewHomeContentHandler(dependency.HomeContent, logger)
			api.With(middleware.NoStore).Get("/system/home-content", homeContentHandler.Public)
		}
		if dependency.Appearance != nil {
			appearanceHandler := system.NewAppearanceHandler(dependency.Appearance, logger)
			api.With(middleware.NoStore).Get("/system/appearance", appearanceHandler.Public)
		}
		if dependency.FooterLinks != nil {
			footerLinksHandler := system.NewFooterLinksHandler(dependency.FooterLinks, logger)
			api.With(middleware.NoStore).Get("/system/footer-links", footerLinksHandler.Public)
		}

		if dependency.OIDCProvider != nil {
			oidcHandler := oidc.NewHandler(dependency.OIDCProvider, dependency.OIDCLogin, dependency.SecureCookies, logger)
			api.With(middleware.NoStore).Get("/auth/methods", oidcHandler.Methods)
			if dependency.OIDCLogin != nil {
				api.With(middleware.NoStore).Get("/auth/oidc/{providerKey}/start", oidcHandler.Start)
				api.With(middleware.NoStore).Get("/auth/oidc/{providerKey}/callback", oidcHandler.Callback)
			}
		}

		api.Group(func(businessAPI chi.Router) {
			businessAPI.Use(middleware.NoStore)
			businessAPI.Use(auth.CurrentUserMiddlewareWithLogger(dependency.CurrentUser, logger))
			if dependency.System != nil {
				systemHandler := system.NewHandlerWithLogger(dependency.System, logger)
				businessAPI.Get("/init/status", systemHandler.Status)
				businessAPI.Post("/init/setup", systemHandler.Setup)
			}
			if dependency.SystemSettings != nil {
				settingsHandler := system.NewSettingsHandler(dependency.SystemSettings, logger)
				businessAPI.Get("/admin/system/settings", settingsHandler.Get)
				businessAPI.Post("/admin/system/settings/update", settingsHandler.Update)
			}
			if dependency.HomeContent != nil {
				homeContentHandler := system.NewHomeContentHandler(dependency.HomeContent, logger)
				businessAPI.Get("/admin/system/home-content", homeContentHandler.Get)
				businessAPI.Post("/admin/system/home-content/update", homeContentHandler.Update)
			}
			if dependency.Appearance != nil {
				appearanceHandler := system.NewAppearanceHandler(dependency.Appearance, logger)
				businessAPI.Get("/admin/system/appearance", appearanceHandler.Get)
				businessAPI.Post("/admin/system/appearance/update", appearanceHandler.Update)
			}
			if dependency.FooterLinks != nil {
				footerLinksHandler := system.NewFooterLinksHandler(dependency.FooterLinks, logger)
				businessAPI.Get("/admin/system/footer-links", footerLinksHandler.Get)
				businessAPI.Post("/admin/system/footer-links/update", footerLinksHandler.Update)
			}
			if dependency.Auth != nil {
				authHandler := auth.NewHandlerWithLogger(dependency.Auth, dependency.SecureCookies, logger)
				businessAPI.Post("/auth/login", authHandler.Login)
				businessAPI.Post("/auth/logout", authHandler.Logout)
				businessAPI.Get("/auth/me", authHandler.Me)
			}
			if dependency.Insights != nil {
				handler := insights.NewHandler(dependency.Insights, logger)
				businessAPI.Get("/admin/dashboard", handler.Dashboard)
				businessAPI.Get("/short-link/visits", handler.Visits)
				businessAPI.Get("/admin/short-link/visits", handler.AdminVisits)
			}
			if dependency.VisitExport != nil {
				handler := insights.NewVisitExportHandler(dependency.VisitExport, logger)
				businessAPI.Get("/short-link/visits/export", handler.ExportVisits)
				businessAPI.Get("/admin/short-link/visits/export", handler.AdminExportVisits)
			}
			if dependency.Audit != nil {
				handler := insights.NewAuditHandler(dependency.Audit, logger)
				businessAPI.Get("/admin/audit/list", handler.List)
			}
			if dependency.AuditExport != nil {
				handler := insights.NewAuditExportHandler(dependency.AuditExport, logger)
				businessAPI.Get("/admin/audit/export", handler.Export)
			}
			if dependency.ShortLinkExport != nil {
				exportHandler := shortlink.NewExportHandler(dependency.ShortLinkExport, logger)
				businessAPI.Get("/short-link/statistics/export", exportHandler.Statistics)
				businessAPI.Get("/admin/short-link/statistics/export", exportHandler.AdminStatistics)
			}
			if dependency.ShortLinkListExport != nil {
				handler := shortlink.NewListExportHandler(dependency.ShortLinkListExport, logger)
				businessAPI.Get("/short-link/export", handler.List)
				businessAPI.Get("/admin/short-link/export", handler.AdminList)
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
			if dependency.ShortLinkBatch != nil {
				batchHandler := shortlink.NewBatchHandler(dependency.ShortLinkBatch, logger)
				businessAPI.Post("/short-link/batch", batchHandler.Batch)
				businessAPI.Post("/admin/short-link/batch", batchHandler.AdminBatch)
			}
			if dependency.ShortLinkTransfer != nil {
				handler := shortlink.NewTransferHandler(dependency.ShortLinkTransfer, logger)
				businessAPI.Post("/admin/short-link/transfer", handler.Transfer)
			}
			if dependency.ShortLinkBatchTransfer != nil {
				handler := shortlink.NewBatchTransferHandler(dependency.ShortLinkBatchTransfer, logger)
				businessAPI.Post("/admin/short-link/batch-transfer", handler.BatchTransfer)
			}
			if dependency.ShortLinkBatchTags != nil {
				handler := shortlink.NewBatchTagsHandler(dependency.ShortLinkBatchTags, logger)
				businessAPI.Post("/short-link/batch-tags", handler.BatchTags)
				businessAPI.Post("/admin/short-link/batch-tags", handler.AdminBatchTags)
			}
			if dependency.Domain != nil {
				domainHandler := domain.NewHandler(dependency.Domain, logger)
				businessAPI.Get("/domain/available", domainHandler.Available)
				businessAPI.Get("/admin/domain/list", domainHandler.List)
				businessAPI.Post("/admin/domain/create", domainHandler.Create)
				businessAPI.Post("/admin/domain/update", domainHandler.Update)
				businessAPI.Post("/admin/domain/set-default", domainHandler.SetDefault)
				businessAPI.Post("/admin/domain/delete", domainHandler.Delete)
			}
			if dependency.DomainOrder != nil {
				orderHandler := domain.NewOrderHandler(dependency.DomainOrder, logger)
				businessAPI.Post("/admin/domain/set-order", orderHandler.SetOrder)
			}
			if dependency.DomainRedirectDefault != nil {
				handler := domain.NewRedirectDefaultHandler(dependency.DomainRedirectDefault, logger)
				businessAPI.Get("/admin/domain/redirect-default", handler.Get)
				businessAPI.Post("/admin/domain/set-redirect-default", handler.Set)
				businessAPI.Get("/domain/redirect-defaults", handler.Available)
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
			if dependency.UserMembership != nil {
				groupHandler := user.NewGroupHandler(dependency.UserMembership, logger)
				businessAPI.Post("/admin/user/change-group", groupHandler.Change)
			}
			if dependency.UserBatchMembership != nil {
				batchHandler := user.NewBatchGroupHandler(dependency.UserBatchMembership, logger)
				businessAPI.Post("/admin/user/batch-change-group", batchHandler.Change)
			}
			if dependency.UserPreferences != nil {
				preferencesHandler := user.NewPreferencesHandler(dependency.UserPreferences, logger)
				businessAPI.Get("/user/preferences", preferencesHandler.Get)
				businessAPI.Post("/user/preferences/update", preferencesHandler.Update)
			}
			if dependency.UserDomainPreference != nil {
				preferenceHandler := user.NewDomainPreferenceHandler(dependency.UserDomainPreference, logger)
				businessAPI.Get("/user/domain-preference", preferenceHandler.Get)
				businessAPI.Post("/user/domain-preference/update", preferenceHandler.Update)
			}
			if dependency.UserTimeZonePreference != nil {
				preferenceHandler := user.NewTimeZonePreferenceHandler(dependency.UserTimeZonePreference, logger)
				businessAPI.Get("/user/time-zone-preference", preferenceHandler.Get)
				businessAPI.Post("/user/time-zone-preference/update", preferenceHandler.Update)
			}
			if dependency.UserGroup != nil {
				userGroupHandler := usergroup.NewHandler(dependency.UserGroup, logger)
				businessAPI.Get("/admin/user-group/list", userGroupHandler.List)
				businessAPI.Post("/admin/user-group/update-permissions", userGroupHandler.UpdatePermissions)
			}
			if dependency.UserGroupDomainDefault != nil {
				groupDefaultHandler := usergroup.NewDomainDefaultHandler(dependency.UserGroupDomainDefault, logger)
				businessAPI.Get("/admin/user-group/domain-default", groupDefaultHandler.Get)
				businessAPI.Post("/admin/user-group/set-domain-default", groupDefaultHandler.Set)
				businessAPI.Get("/domain/group-default", groupDefaultHandler.GetCurrent)
			}
			if dependency.OIDCProvider != nil {
				oidcHandler := oidc.NewHandler(dependency.OIDCProvider, dependency.OIDCLogin, dependency.SecureCookies, logger)
				businessAPI.Get("/admin/oidc/provider/list", oidcHandler.List)
				businessAPI.Post("/admin/oidc/provider/create", oidcHandler.Create)
				businessAPI.Post("/admin/oidc/provider/update", oidcHandler.Update)
				businessAPI.Post("/admin/oidc/provider/delete", oidcHandler.Delete)
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
			business.With(middleware.NoStore).Get("/go/{slug}/continue", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.Continue(w, r, chi.URLParam(r, "slug"))
			})
			business.With(middleware.NoStore).Get("/go/{slug}/preview", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.PreviewScoped(w, r, chi.URLParam(r, "slug"))
			})
		}
		if redirectHandler != nil {
			business.Get("/{slug}", func(w nethttp.ResponseWriter, r *nethttp.Request) {
				redirectHandler.Open(w, r, chi.URLParam(r, "slug"))
			})
		}
	})
	if dependency.StaticDir != "" {
		registerStaticRoutes(router, dependency.StaticDir)
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
		"/profile",
		"/console",
		"/link",
		"/link/{shortLinkId}/analytics",
		"/analytics",
		"/admin/dashboard",
		"/admin/audit",
		"/admin/link",
		"/admin/link/{shortLinkId}/analytics",
		"/admin/user",
		"/admin/user/group",
		"/admin/domain",
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
