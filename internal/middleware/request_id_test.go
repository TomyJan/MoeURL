package middleware

import (
	"encoding/json"
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

func TestRequestIDRandomFailureFailsClosed(t *testing.T) {
	reader := failingRequestIDReader{}
	handlerCalled := false
	handler := requestIDWithReader(reader)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		handlerCalled = true
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/example", nil))

	if handlerCalled {
		t.Fatal("handler was called after request ID generation failed")
	}
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("response status = %d, want 500", response.Code)
	}
	if requestID := response.Header().Get("X-Request-ID"); requestID != "" {
		t.Fatalf("response request ID = %q, want no predictable fallback", requestID)
	}
	responseBody := response.Body.String()
	var body struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal([]byte(responseBody), &body); err != nil {
		t.Fatalf("decode failure response: %v", err)
	}
	if body.Code != 900000 || body.Message != "Internal server error" {
		t.Fatalf("failure response = code %d message %q", body.Code, body.Message)
	}
	if strings.Contains(responseBody, "random source unavailable") {
		t.Fatalf("failure response leaked entropy error: %s", responseBody)
	}
}

type failingRequestIDReader struct{}

func (failingRequestIDReader) Read([]byte) (int, error) {
	return 0, errors.New("random source unavailable")
}
