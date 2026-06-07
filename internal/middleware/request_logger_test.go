package middleware_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

func TestRequestLoggerRecordsStatusAndResponseSize(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{}))
	handler := middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte("created"))
	}))

	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example", nil)
	handler.ServeHTTP(httptest.NewRecorder(), request)

	output := logs.String()
	if !strings.Contains(output, "status=201") {
		t.Fatalf("expected status in log, got %q", output)
	}
	if !strings.Contains(output, "response_size=7") {
		t.Fatalf("expected response size in log, got %q", output)
	}
}

func TestRequestLoggerRecordsImplicitOKStatusAndResponseSize(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{}))
	handler := middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	}))

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/example", nil)
	handler.ServeHTTP(httptest.NewRecorder(), request)

	output := logs.String()
	if !strings.Contains(output, "status=200") {
		t.Fatalf("expected implicit status in log, got %q", output)
	}
	if !strings.Contains(output, "response_size=2") {
		t.Fatalf("expected response size in log, got %q", output)
	}
}

func TestRequestLoggerKeepsImplicitOKWhenWriteHeaderIsCalledAfterWrite(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{}))
	handler := middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
		w.WriteHeader(http.StatusInternalServerError)
	}))

	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/example", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("expected recorder status 200, got %d", response.Code)
	}
	output := logs.String()
	if !strings.Contains(output, "status=200") {
		t.Fatalf("expected logged status to match implicit 200, got %q", output)
	}
}
