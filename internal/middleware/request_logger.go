package middleware

import (
	"log/slog"
	nethttp "net/http"
	"time"

	chimiddleware "github.com/go-chi/chi/v5/middleware"
)

// RequestLogger logs each completed HTTP request with its response status.
func RequestLogger(logger *slog.Logger) func(nethttp.Handler) nethttp.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			startedAt := time.Now()
			recorder := chimiddleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(recorder, r)
			status := recorder.Status()
			if status == 0 {
				status = nethttp.StatusOK
			}
			logger.InfoContext(r.Context(), "http_request",
				"request_id", RequestIDFromContext(r.Context()),
				"method", r.Method,
				"path", r.URL.Path,
				"status", status,
				"response_size", recorder.BytesWritten(),
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}
