package middleware_test

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

func TestRecoveryReturnsSanitizedJSONAndLogsRequestContext(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.RequestID(middleware.Recovery(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("top-secret-panic-value")
	})))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/panic?token=secret-query-value", nil)
	request.Header.Set("X-Request-ID", "safe-request-id")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("response status = %d, want 500", response.Code)
	}
	if contentType := response.Header().Get("Content-Type"); contentType != "application/json; charset=utf-8" {
		t.Fatalf("content type = %q, want JSON", contentType)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode recovery response: %v", err)
	}
	if body.Code != 900000 {
		t.Fatalf("response code = %d, want 900000", body.Code)
	}
	if strings.Contains(response.Body.String(), "top-secret") || strings.Contains(response.Body.String(), "goroutine") {
		t.Fatalf("response leaked panic diagnostics: %q", response.Body.String())
	}

	output := logs.String()
	for _, field := range []string{
		"msg=http_panic_recovered",
		"request_id=safe-request-id",
		"method=POST",
		"path=/panic",
		"stack=",
	} {
		if !strings.Contains(output, field) {
			t.Fatalf("recovery log missing %q: %q", field, output)
		}
	}
	if strings.Contains(output, "secret-query-value") {
		t.Fatalf("recovery log included query parameters: %q", output)
	}
}

func TestRecoveryUsesDefaultLoggerWhenNil(t *testing.T) {
	handler := middleware.Recovery(nil)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("panic handled by default logger")
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/panic", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("response status = %d, want 500", response.Code)
	}
}

func TestRecoveryPassesThroughNormalResponse(t *testing.T) {
	handler := middleware.Recovery(slog.Default())(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/ok", nil))

	if response.Code != http.StatusNoContent {
		t.Fatalf("response status = %d, want 204", response.Code)
	}
}
