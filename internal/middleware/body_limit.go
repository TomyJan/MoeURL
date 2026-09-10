package middleware

import (
	"bytes"
	"io"
	"net/http"
)

// MaxJSONBodyBytes is the maximum accepted body size for non-read-only requests.
const MaxJSONBodyBytes = 1 << 20

// BodyLimit bounds request bodies for every method except GET and HEAD.
func BodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead:
			next.ServeHTTP(w, r)
			return
		}

		if r.ContentLength > MaxJSONBodyBytes {
			_ = r.Body.Close()
			writeMiddlewareError(w, http.StatusOK, 100001, "Invalid request")
			return
		}
		if r.Body != nil {
			limitedBody := http.MaxBytesReader(w, r.Body, MaxJSONBodyBytes)
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
