package middleware

import (
	"log/slog"
	nethttp "net/http"
	"time"
)

// RequestLogger logs each completed HTTP request with its response status.
func RequestLogger(logger *slog.Logger) func(nethttp.Handler) nethttp.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next nethttp.Handler) nethttp.Handler {
		return nethttp.HandlerFunc(func(w nethttp.ResponseWriter, r *nethttp.Request) {
			startedAt := time.Now()
			recorder := newCommitAwareResponseWriter(w, r.ProtoMajor)
			completionOwner, completesAfterReturn := w.(commitAwareResponseWriter)
			logRequest := func(recovered any) {
				status := recorder.Status()
				if status == 0 {
					if recovered != nil && !recorder.Committed() {
						status = nethttp.StatusInternalServerError
					} else if !recorder.Hijacked() {
						status = nethttp.StatusOK
					}
				}
				logger.InfoContext(r.Context(), "http_request",
					"request_id", RequestIDFromContext(r.Context()),
					"method", r.Method,
					"path", r.URL.Path,
					"status", status,
					"response_size", recorder.BytesWritten(),
					"duration_ms", time.Since(startedAt).Milliseconds(),
				)
			}
			defer func() {
				recovered := recover()
				if completesAfterReturn {
					completionOwner.onComplete(func() { logRequest(recovered) })
				} else {
					logRequest(recovered)
				}
				if recovered != nil {
					panic(recovered)
				}
			}()
			next.ServeHTTP(recorder, r)
		})
	}
}
