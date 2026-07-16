package shortlink

import (
	"context"
	"errors"
	"html"
	"net/http"

	"github.com/TomyJan/MoeURL/internal/event"
)

// RedirectPort resolves a short link slug into a redirect target.
type RedirectPort interface {
	Resolve(ctx context.Context, slug string) (RedirectResult, error)
}

// RedirectHandler handles public short link redirect requests.
type RedirectHandler struct {
	service  RedirectPort
	recorder event.Recorder
}

// NewRedirectHandler creates a redirect handler.
func NewRedirectHandler(service RedirectPort, recorders ...event.Recorder) *RedirectHandler {
	recorder := event.Recorder(event.NoopRecorder{})
	if len(recorders) > 0 && recorders[0] != nil {
		recorder = recorders[0]
	}
	return &RedirectHandler{service: service, recorder: recorder}
}

// Open writes the redirect response for a slug.
func (h *RedirectHandler) Open(w http.ResponseWriter, r *http.Request, slug string) {
	result, err := h.service.Resolve(r.Context(), slug)
	if err != nil {
		switch {
		case errors.Is(err, ErrShortLinkMissing):
			http.Error(w, "Short link not found", http.StatusNotFound)
		case errors.Is(err, ErrShortLinkDisabled):
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("Short link disabled"))
		default:
			http.Error(w, "Internal server error", http.StatusInternalServerError)
		}
		return
	}

	w.Header().Set("Location", result.TargetURL)
	w.WriteHeader(http.StatusFound)
	_, writeErr := w.Write([]byte(`<a href="` + html.EscapeString(result.TargetURL) + `">Found</a>.` + "\n\n"))
	if writeErr == nil {
		_ = h.recorder.Record(r.Context(), event.Event{Type: event.RedirectResponseSent, Slug: slug, ShortLinkID: result.ShortLinkID})
	}
}
