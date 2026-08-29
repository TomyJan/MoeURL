package middleware

import (
	"bytes"
	"io"
	"net/http"
)

const maxJSONBodyBytes int64 = 1 << 20

// BodyLimit bounds request bodies for every method except GET and HEAD.
func BodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead:
			next.ServeHTTP(w, r)
			return
		}

		if r.ContentLength > maxJSONBodyBytes {
			_ = r.Body.Close()
			writeMiddlewareError(w, http.StatusOK, 100001, "Invalid request")
			return
		}
		if r.Body != nil {
			limitedBody := http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
			body, err := io.ReadAll(limitedBody)
			_ = limitedBody.Close()
			if err != nil {
				writeMiddlewareError(w, http.StatusOK, 100001, "Invalid request")
				return
			}
			r.Body = io.NopCloser(bytes.NewReader(body))
			r.ContentLength = int64(len(body))
		}
		next.ServeHTTP(w, r)
	})
}
