package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
)

var generatedRequestIDPattern = regexp.MustCompile(`^req-[0-9a-f]{32}$`)

func TestRequestIDPreservesSafeClientValue(t *testing.T) {
	const supplied = "client-ABC_123.:~"
	var contextValue string
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contextValue = RequestIDFromContext(r.Context())
		w.WriteHeader(http.StatusNoContent)
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/example", nil)
	request.Header.Set("X-Request-ID", supplied)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if contextValue != supplied {
		t.Fatalf("context request ID = %q, want %q", contextValue, supplied)
	}
	if got := response.Header().Get("X-Request-ID"); got != supplied {
		t.Fatalf("response request ID = %q, want %q", got, supplied)
	}
}

func TestRequestIDAcceptsMaximumSafeLength(t *testing.T) {
	supplied := strings.Repeat("a", 128)
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := RequestIDFromContext(r.Context()); got != supplied {
			t.Fatalf("context request ID = %q, want maximum-length value", got)
		}
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/example", nil)
	request.Header.Set("X-Request-ID", supplied)
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if got := response.Header().Get("X-Request-ID"); got != supplied {
		t.Fatalf("response request ID = %q, want maximum-length value", got)
	}
}

func TestRequestIDReplacesMissingOrUnsafeValues(t *testing.T) {
	tests := []struct {
		name     string
		supplied string
	}{
		{name: "missing"},
		{name: "too_long", supplied: strings.Repeat("a", 129)},
		{name: "space", supplied: "unsafe request"},
		{name: "control", supplied: "unsafe\nrequest"},
		{name: "delete", supplied: "unsafe\x7frequest"},
		{name: "non_ascii", supplied: "unsafe-请求"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			var contextValue string
			handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				contextValue = RequestIDFromContext(r.Context())
			}))
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/example", nil)
			if test.supplied != "" {
				request.Header.Set("X-Request-ID", test.supplied)
			}
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if !generatedRequestIDPattern.MatchString(contextValue) {
				t.Fatalf("context request ID = %q, want generated stable format", contextValue)
			}
			if got := response.Header().Get("X-Request-ID"); got != contextValue {
				t.Fatalf("response request ID = %q, want context value %q", got, contextValue)
			}
			if contextValue == test.supplied {
				t.Fatalf("unsafe request ID %q was preserved", test.supplied)
			}
		})
	}
}

func TestRequestIDRandomFailureUsesSafeFallback(t *testing.T) {
	reader := failingRequestIDReader{}
	var contextValue string
	handler := requestIDWithReader(reader)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		contextValue = RequestIDFromContext(r.Context())
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/example", nil))

	if !generatedRequestIDPattern.MatchString(contextValue) {
		t.Fatalf("fallback request ID = %q, want generated stable format", contextValue)
	}
	if response.Header().Get("X-Request-ID") != contextValue {
		t.Fatalf("response request ID did not use fallback %q", contextValue)
	}
}

type failingRequestIDReader struct{}

func (failingRequestIDReader) Read([]byte) (int, error) {
	return 0, errors.New("random source unavailable")
}
