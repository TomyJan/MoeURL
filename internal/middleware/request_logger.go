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
			recorder := &statusResponseWriter{ResponseWriter: w, status: nethttp.StatusOK}
			next.ServeHTTP(recorder, r)
			logger.InfoContext(r.Context(), "http_request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", recorder.status,
				"response_size", recorder.bytesWritten,
				"duration_ms", time.Since(startedAt).Milliseconds(),
			)
		})
	}
}

type statusResponseWriter struct {
	nethttp.ResponseWriter
	status       int
	bytesWritten int
	wroteHeader  bool
}

func (w *statusResponseWriter) WriteHeader(status int) {
	if w.wroteHeader {
		return
	}
	w.wroteHeader = true
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *statusResponseWriter) Write(data []byte) (int, error) {
	if !w.wroteHeader {
		w.WriteHeader(nethttp.StatusOK)
	}
	size, err := w.ResponseWriter.Write(data)
	w.bytesWritten += size
	return size, err
}
