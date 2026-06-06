package shortlink

import (
	"context"
	"errors"
	"net/http"
)

type RedirectPort interface {
	Resolve(ctx context.Context, slug string) (RedirectResult, error)
}

type RedirectHandler struct {
	service RedirectPort
}

func NewRedirectHandler(service RedirectPort) *RedirectHandler {
	return &RedirectHandler{service: service}
}

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

	http.Redirect(w, r, result.TargetURL, http.StatusFound)
}
