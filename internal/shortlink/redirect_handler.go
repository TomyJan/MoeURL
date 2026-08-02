package shortlink

import (
	"context"
	"errors"
	"html"
	"net/http"
	"net/url"
	"strings"

	"github.com/TomyJan/MoeURL/internal/event"
)

// RedirectPort handles the three public short-link access actions.
type RedirectPort interface {
	Open(ctx context.Context, slug string) (OpenResult, error)
	Preview(ctx context.Context, slug string) (PreviewResult, error)
	Continue(ctx context.Context, slug string) (RedirectResult, error)
}

// RedirectHandler handles public short-link access requests.
type RedirectHandler struct {
	service       RedirectPort
	recorder      event.Recorder
	countryHeader string
}

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
	handler := NewRedirectHandler(service, recorder)
	handler.countryHeader = countryHeader
	return handler
}

// Open writes either the direct target redirect or the internal intermediate-page redirect.
func (h *RedirectHandler) Open(w http.ResponseWriter, r *http.Request, slug string) {
	result, err := h.service.Open(r.Context(), slug)
	if err != nil {
		writePublicAccessError(w, err)
		return
	}
	if result.RedirectMode == RedirectModeIntermediate {
		http.Redirect(w, r, "/go/"+url.PathEscape(result.Slug), http.StatusFound)
		return
	}
	h.writeTargetRedirect(w, r, result.RedirectResult, result.Slug)
}

// Preview writes the minimal public data required by an intermediate page.
func (h *RedirectHandler) Preview(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(r.URL.Query().Get("slug"))
	if slug == "" {
		businessError(w, 100001, "Invalid request")
		return
	}

	result, err := h.service.Preview(r.Context(), slug)
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

// Continue rechecks a short link and writes its final target redirect.
func (h *RedirectHandler) Continue(w http.ResponseWriter, r *http.Request, slug string) {
	result, err := h.service.Continue(r.Context(), slug)
	if err != nil {
		writePublicAccessError(w, err)
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

func writePublicAccessError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrShortLinkMissing), errors.Is(err, ErrShortLinkNotIntermediate):
		http.Error(w, "Short link not found", http.StatusNotFound)
	case errors.Is(err, ErrShortLinkDisabled):
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Short link disabled"))
	case errors.Is(err, ErrShortLinkExpired):
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("Short link expired"))
	default:
		http.Error(w, "Internal server error", http.StatusInternalServerError)
	}
}
