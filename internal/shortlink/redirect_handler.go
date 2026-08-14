package shortlink

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/event"
)

// RedirectPort handles the public short-link access actions.
type RedirectPort interface {
	Open(ctx context.Context, slug string) (OpenResult, error)
	Preview(ctx context.Context, slug string, accessToken string) (PreviewResult, error)
	Unlock(ctx context.Context, slug string, password string) (AccessGrant, error)
	Continue(ctx context.Context, slug string, accessToken string) (RedirectResult, error)
}

// RedirectHandler handles public short-link access requests.
type RedirectHandler struct {
	service       RedirectPort
	recorder      event.Recorder
	countryHeader string
	secureCookies bool
}

const (
	accessCookieName = "moeurl_short_link_access"
	// maxUnlockRequestBodyBytes is a security boundary that keeps oversized input out of Argon2 validation, alongside the service's 128-character password limit.
	maxUnlockRequestBodyBytes = 4 << 10
)

// NewRedirectHandler creates a redirect handler.
func NewRedirectHandler(service RedirectPort, recorders ...event.Recorder) *RedirectHandler {
	recorder := event.Recorder(event.NoopRecorder{})
	if len(recorders) > 0 && recorders[0] != nil {
		recorder = recorders[0]
	}
	return &RedirectHandler{service: service, recorder: recorder}
}

// NewRedirectHandlerWithAnalytics creates a redirect handler configured for anonymous analytics dimensions.
func NewRedirectHandlerWithAnalytics(service RedirectPort, recorder event.Recorder, countryHeader string) *RedirectHandler {
	return NewRedirectHandlerWithAnalyticsAndSecurity(service, recorder, countryHeader, false)
}

// NewRedirectHandlerWithAnalyticsAndSecurity creates a redirect handler with cookie security settings.
func NewRedirectHandlerWithAnalyticsAndSecurity(service RedirectPort, recorder event.Recorder, countryHeader string, secureCookies bool) *RedirectHandler {
	handler := NewRedirectHandler(service, recorder)
	handler.countryHeader = countryHeader
	handler.secureCookies = secureCookies
	return handler
}

// Open writes either the direct target redirect or an internal interactive-page redirect.
func (h *RedirectHandler) Open(w http.ResponseWriter, r *http.Request, slug string) {
	result, err := h.service.Open(r.Context(), slug)
	if err != nil {
		writePublicAccessError(w, r, slug, err)
		return
	}
	if result.RequiresPassword {
		redirectToPublicAccessState(w, r, slug, "password", nil)
		return
	}
	if isInteractiveRedirectMode(result.RedirectMode) {
		http.Redirect(w, r, "/go/"+url.PathEscape(result.Slug), http.StatusFound)
		return
	}
	h.writeTargetRedirect(w, r, result.RedirectResult, result.Slug)
}

// PreviewPublic serves the deprecated query endpoint for unprotected previews.
// Protected links must use /go/{slug}/preview because the access cookie is path-scoped.
func (h *RedirectHandler) PreviewPublic(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(r.URL.Query().Get("slug"))
	h.preview(w, r, slug, accessTokenFromRequest(r))
}

// PreviewScoped writes public preview data after revalidating the path-scoped access cookie.
func (h *RedirectHandler) PreviewScoped(w http.ResponseWriter, r *http.Request, slug string) {
	if redirectLowercaseScopedSlug(w, r, slug, "/preview") {
		return
	}
	h.preview(w, r, strings.TrimSpace(slug), accessTokenFromRequest(r))
}

// preview writes the minimal public metadata for a normalized preview request.
func (h *RedirectHandler) preview(w http.ResponseWriter, r *http.Request, slug string, accessToken string) {
	if slug == "" {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Preview(r.Context(), slug, accessToken)
	if err != nil {
		switch {
		case errors.Is(err, ErrShortLinkMissing):
			businessError(w, CodeShortLinkMissing, "Short link not found")
		case errors.Is(err, ErrShortLinkDisabled):
			businessError(w, CodeShortLinkDisabled, "Short link disabled")
		case errors.Is(err, ErrShortLinkExpired):
			businessError(w, CodeShortLinkExpired, "Short link expired")
		case errors.Is(err, ErrShortLinkNotInteractive):
			businessError(w, CodeShortLinkNotInteractive, "Short link does not use an interactive access page")
		case errors.Is(err, ErrPasswordRequired):
			businessError(w, CodePasswordRequired, "Password required")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	ok(w, result)
}

// accessTokenFromRequest reads the path-scoped access grant cookie from a request.
func accessTokenFromRequest(r *http.Request) string {
	if cookie, err := r.Cookie(accessCookieName); err == nil {
		return cookie.Value
	}
	return ""
}

// Unlock validates a public short-link password and sets its scoped access cookie.
func (h *RedirectHandler) Unlock(w http.ResponseWriter, r *http.Request, slug string) {
	var input UnlockInput
	r.Body = http.MaxBytesReader(w, r.Body, maxUnlockRequestBodyBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&input); err != nil {
		businessError(w, 100001, "Invalid request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		businessError(w, 100001, "Invalid request")
		return
	}
	slug = strings.ToLower(strings.TrimSpace(slug))
	grant, err := h.service.Unlock(r.Context(), slug, input.Password)
	if err != nil {
		switch {
		case errors.Is(err, ErrPasswordRequired):
			businessError(w, CodePasswordRequired, "Password required")
		case errors.Is(err, ErrInvalidPassword),
			errors.Is(err, ErrShortLinkMissing),
			errors.Is(err, ErrShortLinkDisabled),
			errors.Is(err, ErrShortLinkExpired):
			businessError(w, CodeInvalidPassword, "Invalid password")
		case errors.Is(err, ErrPasswordRateLimited):
			var rateLimitErr *PasswordRateLimitedError
			meta := map[string]any{}
			if errors.As(err, &rateLimitErr) && !rateLimitErr.RetryAt.IsZero() {
				meta["retryAt"] = rateLimitErr.RetryAt.UTC().Format(time.RFC3339Nano)
			}
			writeJSON(w, http.StatusOK, response{Code: CodePasswordRateLimited, Message: "Too many attempts", Data: nil, Meta: meta})
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	maxAge := int(accessGrantTTL / time.Second)
	http.SetCookie(w, &http.Cookie{
		Name:     accessCookieName,
		Value:    grant.Token,
		Path:     "/go/" + url.PathEscape(slug),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
	ok(w, map[string]bool{"unlocked": true})
}

// Continue rechecks a short link and writes its final target redirect.
func (h *RedirectHandler) Continue(w http.ResponseWriter, r *http.Request, slug string) {
	if redirectLowercaseScopedSlug(w, r, slug, "/continue") {
		return
	}
	result, err := h.service.Continue(r.Context(), slug, accessTokenFromRequest(r))
	if err != nil {
		if isPublicAccessError(err) {
			writePublicAccessError(w, r, slug, err)
		} else {
			slog.ErrorContext(r.Context(), "short_link_continue_failed", "slug", strings.ToLower(slug), "error", err)
			redirectToPublicAccessState(w, r, slug, "continue-failed", nil)
		}
		return
	}
	h.writeTargetRedirect(w, r, result, strings.ToLower(slug))
}

type publicAccessErrorKind uint8

const (
	publicAccessErrorUnknown publicAccessErrorKind = iota
	publicAccessErrorMissing
	publicAccessErrorDisabled
	publicAccessErrorExpired
	publicAccessErrorNotInteractive
	publicAccessErrorPassword
	publicAccessErrorRateLimited
)

// isPublicAccessError reports whether an access error is safe to expose as a business response.
func isPublicAccessError(err error) bool {
	return classifyPublicAccessError(err) != publicAccessErrorUnknown
}

// classifyPublicAccessError maps access failures to their safe public response category.
func classifyPublicAccessError(err error) publicAccessErrorKind {
	switch {
	case errors.Is(err, ErrShortLinkMissing):
		return publicAccessErrorMissing
	case errors.Is(err, ErrShortLinkDisabled):
		return publicAccessErrorDisabled
	case errors.Is(err, ErrShortLinkExpired):
		return publicAccessErrorExpired
	case errors.Is(err, ErrShortLinkNotInteractive):
		return publicAccessErrorNotInteractive
	case errors.Is(err, ErrPasswordRequired), errors.Is(err, ErrInvalidPassword):
		return publicAccessErrorPassword
	case errors.Is(err, ErrPasswordRateLimited):
		return publicAccessErrorRateLimited
	default:
		return publicAccessErrorUnknown
	}
}

// redirectLowercaseScopedSlug canonicalizes scoped access paths before cookie-based authorization.
func redirectLowercaseScopedSlug(w http.ResponseWriter, r *http.Request, slug string, suffix string) bool {
	normalizedSlug := strings.ToLower(slug)
	if normalizedSlug == slug {
		return false
	}
	location := "/go/" + url.PathEscape(normalizedSlug) + suffix
	if r.URL.RawQuery != "" {
		location += "?" + r.URL.RawQuery
	}
	http.Redirect(w, r, location, http.StatusFound)
	return true
}

// writeTargetRedirect emits the final redirect before recording a successful access event.
func (h *RedirectHandler) writeTargetRedirect(w http.ResponseWriter, r *http.Request, result RedirectResult, slug string) {
	w.Header().Set("Location", result.TargetURL)
	w.WriteHeader(http.StatusFound)
	_, writeErr := w.Write([]byte(`<a href="` + html.EscapeString(result.TargetURL) + `">Found</a>.` + "\n\n"))
	if writeErr == nil {
		referrerHost, deviceType, countryCode := analyticsEventFields(r, h.countryHeader)
		_ = h.recorder.Record(r.Context(), event.Event{Type: event.RedirectResponseSent, Slug: slug, ShortLinkID: result.ShortLinkID, ReferrerHost: referrerHost, DeviceType: deviceType, CountryCode: countryCode})
	}
}

// writePublicAccessError maps access failures to safe public redirect states.
func writePublicAccessError(w http.ResponseWriter, r *http.Request, slug string, err error) {
	switch classifyPublicAccessError(err) {
	case publicAccessErrorMissing:
		http.Error(w, "Short link not found", http.StatusNotFound)
	case publicAccessErrorDisabled:
		redirectToPublicAccessState(w, r, slug, "disabled", nil)
	case publicAccessErrorExpired:
		redirectToPublicAccessState(w, r, slug, "expired", nil)
	case publicAccessErrorNotInteractive:
		redirectToPublicAccessState(w, r, slug, "not-interactive", nil)
	case publicAccessErrorPassword:
		redirectToPublicAccessState(w, r, slug, "password", nil)
	case publicAccessErrorRateLimited:
		var rateLimitErr *PasswordRateLimitedError
		if errors.As(err, &rateLimitErr) && !rateLimitErr.RetryAt.IsZero() {
			retryAt := rateLimitErr.RetryAt
			redirectToPublicAccessState(w, r, slug, "rate-limited", &retryAt)
			return
		}
		redirectToPublicAccessState(w, r, slug, "rate-limited", nil)
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

// redirectToPublicAccessState redirects visitors to a normalized client-side status route.
func redirectToPublicAccessState(w http.ResponseWriter, r *http.Request, slug string, reason string, retryAt *time.Time) {
	location := "/go/" + url.PathEscape(strings.ToLower(slug)) + "?reason=" + url.QueryEscape(reason)
	if retryAt != nil && !retryAt.IsZero() {
		location += "&retryAt=" + url.QueryEscape(retryAt.UTC().Format(time.RFC3339Nano))
	}
	http.Redirect(w, r, location, http.StatusFound)
}
