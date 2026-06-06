package middleware

import (
	"log/slog"
	nethttp "net/http"
	"time"
)

func RequestLogger(logger *slog.Logger) func(nethttp.Handler) nethttp.Handler {
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			startedAt := time.Now()
			next.ServeHTTP(w, r)
			logger.InfoContext(r.Context(), "http_request",
				"method", r.Method,
				"path", r.URL.Path,
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}
