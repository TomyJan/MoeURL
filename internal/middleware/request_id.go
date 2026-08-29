package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"io"
	"net/http"
)

const (
	requestIDHeader    = "X-Request-ID"
	maxRequestIDLength = 128
)

type requestIDContextKey struct{}

// RequestID validates or creates a request ID and exposes it on the response and request context.
func RequestID(next http.Handler) http.Handler {
	return requestIDWithReader(rand.Reader)(next)
}

func requestIDWithReader(random io.Reader) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			requestID := r.Header.Get(requestIDHeader)
			if !isSafeRequestID(requestID) {
				var err error
				requestID, err = newRequestID(random)
				if err != nil {
					writeMiddlewareError(w, http.StatusInternalServerError, 900000, "Internal server error")
					return
				}
			}

			w.Header().Set(requestIDHeader, requestID)
			ctx := context.WithValue(r.Context(), requestIDContextKey{}, requestID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequestIDFromContext returns the validated request ID associated with a request.
func RequestIDFromContext(ctx context.Context) string {
	requestID, _ := ctx.Value(requestIDContextKey{}).(string)
	return requestID
}

func isSafeRequestID(requestID string) bool {
	if requestID == "" || len(requestID) > maxRequestIDLength {
		return false
	}
	for index := 0; index < len(requestID); index++ {
		if requestID[index] < 0x21 || requestID[index] > 0x7e {
			return false
		}
	}
	return true
}

func newRequestID(random io.Reader) (string, error) {
	var value [16]byte
	if _, err := io.ReadFull(random, value[:]); err != nil {
		return "", err
	}
	return "req-" + hex.EncodeToString(value[:]), nil
}
