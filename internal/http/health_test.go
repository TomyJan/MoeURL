package http

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	nethttp "net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/middleware"
)

func TestHealthLiveDoesNotPingDependency(t *testing.T) {
	checker := &healthCheckerStub{}
	handler := NewHealthHandler(checker, slog.Default())
	response := httptest.NewRecorder()

	handler.Live(response, httptest.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/api/v1/health/live", nil))

	assertHealthResponse(t, response, nethttp.StatusOK, 0, "ok")
	if checker.calls != 0 {
		t.Fatalf("liveness Ping calls = %d, want 0", checker.calls)
	}
}

func TestHealthReadyPingsWithBoundedContext(t *testing.T) {
	checker := &healthCheckerStub{ping: func(ctx context.Context) error {
		deadline, ok := ctx.Deadline()
		if !ok {
			t.Fatal("readiness Ping context has no deadline")
		}
		remaining := time.Until(deadline)
		if remaining <= 0 || remaining > 2*time.Second {
			t.Fatalf("readiness deadline remaining = %s, want (0, 2s]", remaining)
		}
		return nil
	}}
	handler := NewHealthHandler(checker, slog.Default())
	response := httptest.NewRecorder()

	handler.Ready(response, httptest.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/api/v1/health/ready", nil))

	assertHealthResponse(t, response, nethttp.StatusOK, 0, "ok")
	if checker.calls != 1 {
		t.Fatalf("readiness Ping calls = %d, want 1", checker.calls)
	}
}

func TestHealthReadySanitizesFailureAndLogsRequestID(t *testing.T) {
	const diagnostic = "dial postgres://db-user:secret@db.internal/moeurl: refused"
	var logs bytes.Buffer
	checker := &healthCheckerStub{ping: func(context.Context) error { return errors.New(diagnostic) }}
	health := NewHealthHandler(checker, slog.New(slog.NewTextHandler(&logs, nil)))
	handler := middleware.RequestID(nethttp.HandlerFunc(health.Ready))
	request := httptest.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/api/v1/health/ready", nil)
	request.Header.Set("X-Request-ID", "health-request-id")
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	assertHealthResponse(t, response, nethttp.StatusServiceUnavailable, 900000, "unavailable")
	if strings.Contains(response.Body.String(), diagnostic) || strings.Contains(response.Body.String(), "db.internal") {
		t.Fatalf("readiness response leaked database diagnostics: %q", response.Body.String())
	}
	output := logs.String()
	if !strings.Contains(output, "msg=database_readiness_failed") || !strings.Contains(output, "request_id=health-request-id") || !strings.Contains(output, "error_category=dependency") {
		t.Fatalf("readiness log missing event or request ID: %q", output)
	}
	for _, sensitive := range []string{diagnostic, "secret", "db.internal", "postgres://"} {
		if strings.Contains(output, sensitive) {
			t.Fatalf("readiness log leaked %q: %q", sensitive, output)
		}
	}
}

func TestHealthReadyTimesOutAndNilDependencyFailsClosed(t *testing.T) {
	t.Run("timeout", func(t *testing.T) {
		var logs bytes.Buffer
		checker := &healthCheckerStub{ping: func(ctx context.Context) error {
			<-ctx.Done()
			return ctx.Err()
		}}
		handler := newHealthHandler(checker, slog.New(slog.NewTextHandler(&logs, nil)), 10*time.Millisecond)
		response := httptest.NewRecorder()

		handler.Ready(response, httptest.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/api/v1/health/ready", nil))

		assertHealthResponse(t, response, nethttp.StatusServiceUnavailable, 900000, "unavailable")
		if output := logs.String(); !strings.Contains(output, "error_category=timeout") || strings.Contains(output, "deadline exceeded") {
			t.Fatalf("readiness timeout log = %q, want safe timeout category", output)
		}
	})

	t.Run("nil_dependency", func(t *testing.T) {
		handler := NewHealthHandler(nil, nil)
		response := httptest.NewRecorder()

		handler.Ready(response, httptest.NewRequestWithContext(t.Context(), nethttp.MethodGet, "/api/v1/health/ready", nil))

		assertHealthResponse(t, response, nethttp.StatusServiceUnavailable, 900000, "unavailable")
	})
}

func assertHealthResponse(t *testing.T, response *httptest.ResponseRecorder, status int, code int, healthStatus string) {
	t.Helper()
	if response.Code != status {
		t.Fatalf("response status = %d, want %d", response.Code, status)
	}
	var body struct {
		Code int `json:"code"`
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode health response: %v", err)
	}
	if body.Code != code || body.Data.Status != healthStatus {
		t.Fatalf("health response = code %d status %q, want %d and %q", body.Code, body.Data.Status, code, healthStatus)
	}
}

type healthCheckerStub struct {
	calls int
	ping  func(context.Context) error
}

func (checker *healthCheckerStub) Ping(ctx context.Context) error {
	checker.calls++
	if checker.ping == nil {
		return nil
	}
	return checker.ping(ctx)
}
