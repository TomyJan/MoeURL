package middleware

import "net/http"

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
			r.Body = http.MaxBytesReader(w, r.Body, maxJSONBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}
