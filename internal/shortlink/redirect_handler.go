package shortlink

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/TomyJan/MoeURL/internal/event"
)

// RedirectPort handles the three public short-link access actions.
type RedirectPort interface {
	Open(ctx context.Context, slug string) (OpenResult, error)
	Preview(ctx context.Context, slug string, accessTokens ...string) (PreviewResult, error)
	Continue(ctx context.Context, slug string, accessTokens ...string) (RedirectResult, error)
}

type UnlockPort interface {
	Unlock(ctx context.Context, slug string, password string) (AccessGrant, error)
}

// RedirectHandler handles public short-link access requests.
type RedirectHandler struct {
	service       RedirectPort
	recorder      event.Recorder
	countryHeader string
	secureCookies bool
}

const (
	accessCookieName          = "moeurl_short_link_access"
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

// Open writes either the direct target redirect or the internal intermediate-page redirect.
func (h *RedirectHandler) Open(w http.ResponseWriter, r *http.Request, slug string) {
	result, err := h.service.Open(r.Context(), slug)
	if err != nil {
		writePublicAccessError(w, r, slug, err)
		return
	}
	if result.RequiresPassword {
		redirectToPublicAccessState(w, r, slug, "password")
		return
	}
	if result.RedirectMode == RedirectModeIntermediate {
		http.Redirect(w, r, "/go/"+url.PathEscape(result.Slug), http.StatusFound)
		return
	}
	h.writeTargetRedirect(w, r, result.RedirectResult, result.Slug)
}

// Preview writes the minimal public data required by an intermediate page.
func (h *RedirectHandler) Preview(w http.ResponseWriter, r *http.Request, pathSlugs ...string) {
	slug := strings.TrimSpace(r.URL.Query().Get("slug"))
	if len(pathSlugs) > 0 {
		slug = strings.TrimSpace(pathSlugs[0])
	}
	if slug == "" {
		businessError(w, 100001, "Invalid request")
		return
	}

	accessToken := ""
	if len(pathSlugs) > 0 {
		if cookie, cookieErr := r.Cookie(accessCookieName); cookieErr == nil {
			accessToken = cookie.Value
		}
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
		case errors.Is(err, ErrShortLinkNotIntermediate):
			businessError(w, CodeShortLinkNotIntermediate, "Short link does not use an intermediate page")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	ok(w, result)
}

// Unlock validates a public short-link password and sets its scoped access cookie.
func (h *RedirectHandler) Unlock(w http.ResponseWriter, r *http.Request) {
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
	unlockService, supported := h.service.(UnlockPort)
	if !supported {
		writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		return
	}
	grant, err := unlockService.Unlock(r.Context(), input.Slug, input.Password)
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
			businessError(w, CodePasswordRateLimited, "Too many attempts")
		default:
			writeJSON(w, http.StatusInternalServerError, response{Code: 900000, Message: "Internal server error", Data: nil, Meta: map[string]any{}})
		}
		return
	}

	slug := strings.ToLower(strings.TrimSpace(input.Slug))
	http.SetCookie(w, &http.Cookie{
		Name:     accessCookieName,
		Value:    grant.Token,
		Path:     "/go/" + url.PathEscape(slug),
		HttpOnly: true,
		Secure:   h.secureCookies,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(accessGrantTTL.Seconds()),
	})
	ok(w, map[string]bool{"unlocked": true})
}

// Continue rechecks a short link and writes its final target redirect.
func (h *RedirectHandler) Continue(w http.ResponseWriter, r *http.Request, slug string) {
	accessToken := ""
	if cookie, cookieErr := r.Cookie(accessCookieName); cookieErr == nil {
		accessToken = cookie.Value
	}
	result, err := h.service.Continue(r.Context(), slug, accessToken)
	if err != nil {
		writePublicAccessError(w, r, slug, err)
		return
	}
	h.writeTargetRedirect(w, r, result, strings.ToLower(slug))
}

func (h *RedirectHandler) writeTargetRedirect(w http.ResponseWriter, r *http.Request, result RedirectResult, slug string) {
	w.Header().Set("Location", result.TargetURL)
	w.WriteHeader(http.StatusFound)
	_, writeErr := w.Write([]byte(`<a href="` + html.EscapeString(result.TargetURL) + `">Found</a>.` + "\n\n"))
	if writeErr == nil {
		referrerHost, deviceType, countryCode := analyticsEventFields(r, h.countryHeader)
		_ = h.recorder.Record(r.Context(), event.Event{Type: event.RedirectResponseSent, Slug: slug, ShortLinkID: result.ShortLinkID, ReferrerHost: referrerHost, DeviceType: deviceType, CountryCode: countryCode})
	}
}

func writePublicAccessError(w http.ResponseWriter, r *http.Request, slug string, err error) {
	switch {
	case errors.Is(err, ErrShortLinkMissing):
		http.Error(w, "Short link not found", http.StatusNotFound)
	case errors.Is(err, ErrShortLinkDisabled):
		redirectToPublicAccessState(w, r, slug, "disabled")
	case errors.Is(err, ErrShortLinkExpired):
		redirectToPublicAccessState(w, r, slug, "expired")
	case errors.Is(err, ErrShortLinkNotIntermediate):
		redirectToPublicAccessState(w, r, slug, "not-intermediate")
	case errors.Is(err, ErrPasswordRequired), errors.Is(err, ErrInvalidPassword):
		redirectToPublicAccessState(w, r, slug, "password")
	case errors.Is(err, ErrPasswordRateLimited):
		redirectToPublicAccessState(w, r, slug, "rate-limited")
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}

func redirectToPublicAccessState(w http.ResponseWriter, r *http.Request, slug string, reason string) {
	location := "/go/" + url.PathEscape(strings.ToLower(slug)) + "?reason=" + url.QueryEscape(reason)
	http.Redirect(w, r, location, http.StatusFound)
}
