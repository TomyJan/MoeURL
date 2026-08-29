package middleware_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

func TestRecoveryReturnsSanitizedJSONAndLogsRequestContext(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.RequestID(middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("top-secret-panic-value")
	}))))
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
	responseBody := response.Body.String()
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(strings.NewReader(responseBody)).Decode(&body); err != nil {
		t.Fatalf("decode recovery response: %v", err)
	}
	if body.Code != 900000 {
		t.Fatalf("response code = %d, want 900000", body.Code)
	}
	if strings.Contains(responseBody, "top-secret") || strings.Contains(responseBody, "goroutine") {
		t.Fatalf("response leaked panic diagnostics: %q", responseBody)
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
	if strings.Count(output, "msg=http_request") != 1 || !strings.Contains(output, "status=500") || !strings.Contains(output, "response_size="+strconv.Itoa(len(responseBody))) {
		t.Fatalf("panic request log = %q, want one HTTP 500 event with %d response bytes", output, len(responseBody))
	}
	if strings.Index(output, "msg=http_request") < strings.Index(output, "msg=http_panic_recovered") {
		t.Fatalf("middleware log order = %q, want request logging after recovery completes", output)
	}
}

func TestRecoveryHandlesInvalidWriteHeaderStatusBeforeCommit(t *testing.T) {
	for _, status := range []int{99, 1000} {
		t.Run(strconv.Itoa(status), func(t *testing.T) {
			handler := middleware.Recovery(slog.New(slog.NewTextHandler(io.Discard, nil)))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
			}))
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/invalid-status", nil))

			if response.Code != http.StatusInternalServerError {
				t.Fatalf("response status = %d, want 500", response.Code)
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
		})
	}
}

func TestRecoveryAbortsCommittedResponseWithoutAppendingError(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.RequestID(middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte("partial"))
		w.(http.Flusher).Flush()
		panic("committed-panic")
	}))))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/committed-panic", nil)
	request.Header.Set("X-Request-ID", "committed-request-id")
	response := httptest.NewRecorder()

	recovered := capturePanic(t, func() { handler.ServeHTTP(response, request) })

	if recovered != http.ErrAbortHandler {
		t.Fatalf("recovered panic = %v, want http.ErrAbortHandler", recovered)
	}
	if response.Code != http.StatusAccepted || response.Body.String() != "partial" || !response.Flushed {
		t.Fatalf("committed response = HTTP %d body %q flushed %t", response.Code, response.Body.String(), response.Flushed)
	}
	output := logs.String()
	if strings.Count(output, "msg=http_request") != 1 || !strings.Contains(output, "status=202") || !strings.Contains(output, "response_size=7") {
		t.Fatalf("committed panic request log = %q, want one HTTP 202 event with 7 bytes", output)
	}
	if strings.Count(output, "msg=http_panic_recovered") != 1 {
		t.Fatalf("committed panic recovery log = %q, want one recovery event", output)
	}
}

func TestRecoveryAbortsFlushOnlyResponseWithoutAppendingError(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.RequestID(middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.(http.Flusher).Flush()
		panic("flush-only-panic")
	}))))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/flush-only-panic", nil)
	request.Header.Set("X-Request-ID", "flush-only-request-id")
	response := httptest.NewRecorder()

	recovered := capturePanic(t, func() { handler.ServeHTTP(response, request) })

	if recovered != http.ErrAbortHandler {
		t.Fatalf("recovered panic = %v, want http.ErrAbortHandler", recovered)
	}
	if response.Code != http.StatusOK || response.Body.Len() != 0 || !response.Flushed {
		t.Fatalf("flush-only response = HTTP %d body %q flushed %t", response.Code, response.Body.String(), response.Flushed)
	}
	output := logs.String()
	if strings.Count(output, "msg=http_request") != 1 || !strings.Contains(output, "status=200") || !strings.Contains(output, "response_size=0") {
		t.Fatalf("flush-only panic request log = %q, want one HTTP 200 event with 0 bytes", output)
	}
	if strings.Count(output, "msg=http_panic_recovered") != 1 {
		t.Fatalf("flush-only recovery log = %q, want one recovery event", output)
	}
}

func TestRecoveryAbortsHijackedResponseWithoutAppendingError(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	writer := newOptionalResponseWriter()
	writer.hijackErr = nil
	handler := middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if _, _, err := w.(http.Hijacker).Hijack(); err != nil {
			t.Fatalf("hijack response: %v", err)
		}
		panic("hijacked-panic")
	})))
	request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/hijacked-panic", nil)
	request.ProtoMajor = 1

	recovered := capturePanic(t, func() { handler.ServeHTTP(writer, request) })

	if recovered != http.ErrAbortHandler {
		t.Fatalf("recovered panic = %v, want http.ErrAbortHandler", recovered)
	}
	if !writer.hijacked {
		t.Fatal("underlying response writer was not hijacked")
	}
	if writer.body.Len() != 0 {
		t.Fatalf("hijacked response appended body %q", writer.body.String())
	}
	output := logs.String()
	if strings.Count(output, "msg=http_request") != 1 || strings.Count(output, "msg=http_panic_recovered") != 1 {
		t.Fatalf("hijacked panic logs = %q, want one request and one recovery event", output)
	}
}

func TestRecoveryHandlesUncomparablePanicValue(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic([]byte("secret"))
	})))
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/slice-panic", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("response status = %d, want 500", response.Code)
	}
	var body struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode recovery response: %v", err)
	}
	if body.Code != 900000 || strings.Contains(response.Body.String(), "secret") {
		t.Fatalf("uncomparable panic response = code %d body %q", body.Code, response.Body.String())
	}
	output := logs.String()
	if strings.Count(output, "msg=http_request") != 1 || strings.Count(output, "msg=http_panic_recovered") != 1 || strings.Contains(output, "secret") {
		t.Fatalf("uncomparable panic logs = %q", output)
	}
}

func TestRecoveryRepanicsAbortHandlerWithoutRecoveryStack(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&logs, nil))
	handler := middleware.Recovery(logger)(middleware.RequestLogger(logger)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic(http.ErrAbortHandler)
	})))
	response := httptest.NewRecorder()

	recovered := capturePanic(t, func() {
		handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/abort", nil))
	})

	if recovered != http.ErrAbortHandler {
		t.Fatalf("recovered panic = %v, want original http.ErrAbortHandler", recovered)
	}
	output := logs.String()
	if strings.Contains(output, "msg=http_panic_recovered") || strings.Contains(output, "stack=") {
		t.Fatalf("abort handler panic produced ordinary recovery log: %q", output)
	}
	if strings.Count(output, "msg=http_request") != 1 {
		t.Fatalf("abort handler request log = %q, want one request event", output)
	}
}

func TestRecoveryPreservesOptionalResponseWriterInterfaces(t *testing.T) {
	tests := []struct {
		name       string
		protoMajor int
		assert     func(*testing.T, http.ResponseWriter)
	}{
		{
			name:       "HTTP1",
			protoMajor: 1,
			assert: func(t *testing.T, writer http.ResponseWriter) {
				if _, ok := writer.(http.Flusher); !ok {
					t.Error("wrapped HTTP/1 writer lost http.Flusher")
				}
				if _, ok := writer.(http.Hijacker); !ok {
					t.Error("wrapped HTTP/1 writer lost http.Hijacker")
				}
				if _, ok := writer.(io.ReaderFrom); !ok {
					t.Error("wrapped HTTP/1 writer lost io.ReaderFrom")
				}
			},
		},
		{
			name:       "HTTP2",
			protoMajor: 2,
			assert: func(t *testing.T, writer http.ResponseWriter) {
				if _, ok := writer.(http.Flusher); !ok {
					t.Error("wrapped HTTP/2 writer lost http.Flusher")
				}
				if _, ok := writer.(http.Pusher); !ok {
					t.Error("wrapped HTTP/2 writer lost http.Pusher")
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := middleware.Recovery(slog.New(slog.NewTextHandler(io.Discard, nil)))(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				test.assert(t, w)
			}))
			request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/interfaces", nil)
			request.ProtoMajor = test.protoMajor

			handler.ServeHTTP(newOptionalResponseWriter(), request)
		})
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

func capturePanic(t *testing.T, action func()) any {
	t.Helper()
	var recovered any
	func() {
		defer func() { recovered = recover() }()
		action()
	}()
	if recovered == nil {
		t.Fatal("expected handler to panic")
	}
	return recovered
}
