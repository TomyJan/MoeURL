package middleware

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"runtime/debug"
)

// Recovery logs panics and returns a sanitized internal-error response.
func Recovery(logger *slog.Logger) func(http.Handler) http.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writer := newCommitAwareResponseWriter(w, r.ProtoMajor)
			defer writer.complete()
			defer func() {
				recovered := recover()
				if recovered == nil {
					return
				}
				if recoveredError, ok := recovered.(error); ok && recoveredError == http.ErrAbortHandler {
					panic(recovered)
				}
				logger.ErrorContext(r.Context(), "http_panic_recovered",
					"request_id", RequestIDFromContext(r.Context()),
					"method", r.Method,
					"path", r.URL.Path,
					"stack", string(debug.Stack()),
				)
				if !writer.Committed() {
					writer.Header().Del("Content-Length")
					writer.Header().Del("Content-Encoding")
					writeMiddlewareError(writer, http.StatusInternalServerError, 900000, "Internal server error")
					return
				}
				panic(http.ErrAbortHandler)
			}()
			next.ServeHTTP(writer, r)
		})
	}
}

// writeMiddlewareError writes the stable JSON envelope used by infrastructure middleware.
func writeMiddlewareError(w http.ResponseWriter, status int, code int, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    any            `json:"data"`
		Meta    map[string]any `json:"meta"`
	}{Code: code, Message: message, Data: nil, Meta: map[string]any{}})
}
