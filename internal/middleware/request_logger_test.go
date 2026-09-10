package middleware_test

import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

// TestRequestLoggerRecordsStatusAndResponseSize verifies request logger records status and response size.
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

// TestRequestLoggerRecordsSafeRequestMetadata verifies request logging includes request identity without query or body data.
func TestRequestLoggerRecordsSafeRequestMetadata(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.RequestID(middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("ok"))
	})))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/example?token=query-secret", strings.NewReader("body-secret"))
	request.Header.Set("X-Request-ID", "request-123")

	handler.ServeHTTP(httptest.NewRecorder(), request)

	output := logs.String()
	for _, field := range []string{
		"request_id=request-123",
		"method=POST",
		"path=/api/v1/example",
		"status=200",
		"response_size=2",
		"duration_ms=",
	} {
		if !strings.Contains(output, field) {
			t.Fatalf("request log missing %q: %q", field, output)
		}
	}
	if strings.Contains(output, "query-secret") || strings.Contains(output, "body-secret") {
		t.Fatalf("request log exposed query or body: %q", output)
	}
}

// TestRequestLoggerRecordsImplicitOKStatusAndResponseSize verifies request logger records implicit ok status and response size.
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

// TestRequestLoggerKeepsImplicitOKWhenWriteHeaderIsCalledAfterWrite verifies request logger keeps implicit ok when write header is called after write.
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

// TestRequestLoggerPreservesHTTP1OptionalInterfaces verifies HTTP/1 streaming and connection interfaces remain available.
func TestRequestLoggerPreservesHTTP1OptionalInterfaces(t *testing.T) {
	writer := newOptionalResponseWriter()
	handler := middleware.RequestLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, ok := w.(http.Flusher); !ok {
			t.Error("wrapped HTTP/1 writer lost http.Flusher")
		}
		if _, ok := w.(http.Hijacker); !ok {
			t.Error("wrapped HTTP/1 writer lost http.Hijacker")
		}
		if _, ok := w.(io.ReaderFrom); !ok {
			t.Error("wrapped HTTP/1 writer lost io.ReaderFrom")
		}
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/stream", nil)
	request.ProtoMajor = 1

	handler.ServeHTTP(writer, request)
}

// TestRequestLoggerPreservesHTTP2OptionalInterfaces verifies HTTP/2 flush and push interfaces remain available.
func TestRequestLoggerPreservesHTTP2OptionalInterfaces(t *testing.T) {
	writer := newOptionalResponseWriter()
	handler := middleware.RequestLogger(slog.New(slog.NewTextHandler(io.Discard, nil)))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, ok := w.(http.Flusher); !ok {
			t.Error("wrapped HTTP/2 writer lost http.Flusher")
		}
		if _, ok := w.(http.Pusher); !ok {
			t.Error("wrapped HTTP/2 writer lost http.Pusher")
		}
	}))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/stream", nil)
	request.ProtoMajor = 2

	handler.ServeHTTP(writer, request)
}

// TestRequestLoggerUsesDefaultLoggerWhenNil verifies direct middleware use cannot panic on a nil logger.
func TestRequestLoggerUsesDefaultLoggerWhenNil(t *testing.T) {
	original := slog.Default()
	var logs bytes.Buffer
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(original) })
	handler := middleware.RequestLogger(nil)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/default-logger", nil))

	if !strings.Contains(logs.String(), "msg=http_request") {
		t.Fatalf("default logger output = %q, want request event", logs.String())
	}
}

type optionalResponseWriter struct {
	header    http.Header
	body      bytes.Buffer
	hijackErr error
	hijacked  bool
}

func newOptionalResponseWriter() *optionalResponseWriter {
	return &optionalResponseWriter{header: make(http.Header), hijackErr: errors.New("test hijack")}
}

func (w *optionalResponseWriter) Header() http.Header {
	return w.header
}

func (w *optionalResponseWriter) WriteHeader(int) {}

func (w *optionalResponseWriter) Write(data []byte) (int, error) {
	return w.body.Write(data)
}

func (*optionalResponseWriter) Flush() {}

func (w *optionalResponseWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	w.hijacked = w.hijackErr == nil
	return nil, nil, w.hijackErr
}

func (*optionalResponseWriter) Push(string, *http.PushOptions) error {
	return nil
}

func (w *optionalResponseWriter) ReadFrom(reader io.Reader) (int64, error) {
	return w.body.ReadFrom(reader)
}
