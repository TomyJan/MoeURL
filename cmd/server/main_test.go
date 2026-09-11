package main

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	nethttp "net/http"
	"os"
	"reflect"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/config"
)

const testLifecycleTimeout = 5 * time.Second

type stubApplication struct {
	runFn      func() error
	shutdownFn func(context.Context) error

	mu            sync.Mutex
	shutdownCalls int
}

// Run delegates server execution to the test-controlled function.
func (a *stubApplication) Run() error {
	return a.runFn()
}

// Shutdown records the call before delegating to the test-controlled function.
func (a *stubApplication) Shutdown(ctx context.Context) error {
	a.mu.Lock()
	a.shutdownCalls++
	a.mu.Unlock()
	return a.shutdownFn(ctx)
}

// shutdownCallCount returns the number of observed shutdown calls.
func (a *stubApplication) shutdownCallCount() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.shutdownCalls
}

// TestRunShutsDownForSupportedSignals verifies SIGINT and SIGTERM share the bounded graceful shutdown path.
func TestRunShutsDownForSupportedSignals(t *testing.T) {
	for _, test := range []struct {
		name   string
		signal os.Signal
	}{
		{name: "SIGINT", signal: syscall.SIGINT},
		{name: "SIGTERM", signal: syscall.SIGTERM},
	} {
		t.Run(test.name, func(t *testing.T) {
			signalSource := make(chan os.Signal, 1)
			runStarted := make(chan struct{})
			serverStopped := make(chan struct{})
			var stopServer sync.Once
			var notifiedSignals []os.Signal
			logger, output := testLogger()
			application := &stubApplication{
				runFn: func() error {
					close(runStarted)
					<-serverStopped
					return nil
				},
				shutdownFn: func(ctx context.Context) error {
					deadline, ok := ctx.Deadline()
					if !ok {
						t.Error("shutdown context has no deadline")
					} else if remaining := time.Until(deadline); remaining < 14*time.Second || remaining > 15*time.Second {
						t.Errorf("shutdown deadline remaining = %s, want about 15s", remaining)
					}
					stopServer.Do(func() { close(serverStopped) })
					return nil
				},
			}
			notify := func(parent context.Context, signals ...os.Signal) (context.Context, context.CancelFunc) {
				notifiedSignals = append([]os.Signal(nil), signals...)
				ctx, cancel := context.WithCancel(parent)
				go func() {
					select {
					case <-signalSource:
						cancel()
					case <-ctx.Done():
					}
				}()
				return ctx, cancel
			}

			result := make(chan error, 1)
			go func() {
				result <- run(context.Background(), testServerConfig(), logger, stubFactory(application), notify)
			}()
			waitForTestSignal(t, runStarted, "server start")
			signalSource <- test.signal

			if err := waitForTestValue(t, result, "run result"); err != nil {
				t.Fatalf("run after %s = %v, want nil", test.name, err)
			}
			if application.shutdownCallCount() != 1 {
				t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
			}
			wantSignals := []os.Signal{os.Interrupt, syscall.SIGTERM}
			if !reflect.DeepEqual(notifiedSignals, wantSignals) {
				t.Fatalf("registered signals = %v, want %v", notifiedSignals, wantSignals)
			}
			if !strings.Contains(output.String(), "server_shutdown_complete") {
				t.Fatalf("logs = %q, want server_shutdown_complete", output.String())
			}
		})
	}
}

// TestRunShutsDownWhenParentContextIsCanceled verifies callers can trigger the same lifecycle without a process signal.
func TestRunShutsDownWhenParentContextIsCanceled(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	runStarted := make(chan struct{})
	serverStopped := make(chan struct{})
	application := &stubApplication{
		runFn: func() error {
			close(runStarted)
			<-serverStopped
			return nil
		},
		shutdownFn: func(context.Context) error {
			close(serverStopped)
			return nil
		},
	}
	notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(parent)
	}
	logger, _ := testLogger()
	result := make(chan error, 1)
	go func() {
		result <- run(parent, testServerConfig(), logger, stubFactory(application), notify)
	}()
	waitForTestSignal(t, runStarted, "server start")
	cancelParent()

	if err := waitForTestValue(t, result, "run result"); err != nil {
		t.Fatalf("run after parent cancellation = %v, want nil", err)
	}
	if application.shutdownCallCount() != 1 {
		t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
	}
}

// TestRunShutsDownAfterServerStops verifies every server exit drains application dependencies.
func TestRunShutsDownAfterServerStops(t *testing.T) {
	serverFailure := errors.New("listen failed")
	for _, test := range []struct {
		name         string
		serverResult error
		wantError    error
		wantFaultLog bool
	}{
		{name: "unexpected failure", serverResult: serverFailure, wantError: serverFailure, wantFaultLog: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			application := &stubApplication{
				runFn:      func() error { return test.serverResult },
				shutdownFn: func(context.Context) error { return nil },
			}
			logger, output := testLogger()
			notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
				return context.WithCancel(parent)
			}

			err := run(context.Background(), testServerConfig(), logger, stubFactory(application), notify)
			if !errors.Is(err, test.wantError) {
				t.Fatalf("run error = %v, want %v", err, test.wantError)
			}
			if application.shutdownCallCount() != 1 {
				t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
			}
			if got := strings.Contains(output.String(), "server_stopped"); got != test.wantFaultLog {
				t.Fatalf("server_stopped logged = %t, want %t; logs = %q", got, test.wantFaultLog, output.String())
			}
		})
	}
}

// TestRunTreatsEarlyHTTPServerClosedAsFailure verifies the sentinel is unexpected before shutdown begins.
func TestRunTreatsEarlyHTTPServerClosedAsFailure(t *testing.T) {
	application := &stubApplication{
		runFn:      func() error { return nethttp.ErrServerClosed },
		shutdownFn: func(context.Context) error { return nil },
	}
	logger, output := testLogger()
	notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(parent)
	}

	if err := run(context.Background(), testServerConfig(), logger, stubFactory(application), notify); !errors.Is(err, nethttp.ErrServerClosed) {
		t.Fatalf("run error = %v, want http.ErrServerClosed", err)
	}
	if application.shutdownCallCount() != 1 {
		t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
	}
	if !strings.Contains(output.String(), "server_stopped") {
		t.Fatalf("logs = %q, want early http.ErrServerClosed recorded as server_stopped", output.String())
	}
}

// TestRunIgnoresHTTPServerClosedAfterShutdown verifies the sentinel is normal after shutdown starts.
func TestRunIgnoresHTTPServerClosedAfterShutdown(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	runStarted := make(chan struct{})
	serverStopped := make(chan struct{})
	application := &stubApplication{
		runFn: func() error {
			close(runStarted)
			<-serverStopped
			return nethttp.ErrServerClosed
		},
		shutdownFn: func(context.Context) error {
			close(serverStopped)
			return nil
		},
	}
	logger, output := testLogger()
	notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(parent)
	}
	result := make(chan error, 1)
	go func() {
		result <- run(parent, testServerConfig(), logger, stubFactory(application), notify)
	}()

	waitForTestSignal(t, runStarted, "server start")
	cancelParent()
	if err := waitForTestValue(t, result, "run result"); err != nil {
		t.Fatalf("run error = %v, want nil", err)
	}
	if application.shutdownCallCount() != 1 {
		t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
	}
	if strings.Contains(output.String(), "server_stopped") {
		t.Fatalf("logs = %q, must not record post-shutdown http.ErrServerClosed as server_stopped", output.String())
	}
}

// TestRunReturnsJoinedServerAndShutdownFailures verifies a failed drain produces non-zero semantics without hiding the server failure.
func TestRunReturnsJoinedServerAndShutdownFailures(t *testing.T) {
	serverFailure := errors.New("serve failed")
	shutdownFailure := errors.New("drain failed")
	application := &stubApplication{
		runFn:      func() error { return serverFailure },
		shutdownFn: func(context.Context) error { return shutdownFailure },
	}
	logger, output := testLogger()
	notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(parent)
	}

	err := run(context.Background(), testServerConfig(), logger, stubFactory(application), notify)
	if !errors.Is(err, serverFailure) || !errors.Is(err, shutdownFailure) {
		t.Fatalf("run error = %v, want joined server and shutdown failures", err)
	}
	if application.shutdownCallCount() != 1 {
		t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
	}
	if !strings.Contains(output.String(), "server_shutdown_failed") {
		t.Fatalf("logs = %q, want server_shutdown_failed", output.String())
	}
}

// TestRunStopsWaitingWhenShutdownExceedsDeadline verifies process exit remains bounded when dependency closure ignores Context.
func TestRunStopsWaitingWhenShutdownExceedsDeadline(t *testing.T) {
	parent, cancelParent := context.WithCancel(context.Background())
	runStarted := make(chan struct{})
	serverStopped := make(chan struct{})
	shutdownStarted := make(chan struct{})
	shutdownContextDone := make(chan struct{})
	releaseShutdown := make(chan struct{})
	shutdownReturned := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(releaseShutdown) }) }
	defer release()

	application := &stubApplication{
		runFn: func() error {
			close(runStarted)
			<-serverStopped
			return nethttp.ErrServerClosed
		},
		shutdownFn: func(ctx context.Context) error {
			close(shutdownStarted)
			<-ctx.Done()
			close(shutdownContextDone)
			<-releaseShutdown
			close(serverStopped)
			close(shutdownReturned)
			return nil
		},
	}
	notify := func(parent context.Context, _ ...os.Signal) (context.Context, context.CancelFunc) {
		return context.WithCancel(parent)
	}
	logger, output := testLogger()
	result := make(chan error, 1)
	go func() {
		result <- runWithShutdownTimeout(parent, testServerConfig(), logger, stubFactory(application), notify, 20*time.Millisecond)
	}()

	waitForTestSignal(t, runStarted, "server start")
	cancelParent()
	waitForTestSignal(t, shutdownStarted, "shutdown start")
	waitForTestSignal(t, shutdownContextDone, "shutdown context deadline")

	var err error
	select {
	case err = <-result:
	case <-time.After(250 * time.Millisecond):
		release()
		waitForTestSignal(t, shutdownReturned, "blocked shutdown release")
		err = waitForTestValue(t, result, "run result after blocked shutdown release")
		t.Fatalf("run remained blocked after the shutdown deadline; final result after release = %v", err)
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("run error = %v, want context deadline exceeded", err)
	}
	if application.shutdownCallCount() != 1 {
		t.Fatalf("shutdown calls = %d, want 1", application.shutdownCallCount())
	}
	if !strings.Contains(output.String(), "server_shutdown_failed") {
		t.Fatalf("logs = %q, want server_shutdown_failed", output.String())
	}
	if strings.Contains(output.String(), "server_shutdown_complete") {
		t.Fatalf("logs = %q, must not record a timed-out shutdown as complete", output.String())
	}

	release()
	waitForTestSignal(t, shutdownReturned, "shutdown goroutine exit")
}

// TestWaitForShutdownResultPrefersCompletedResult verifies an available completion wins over simultaneous Context cancellation.
func TestWaitForShutdownResultPrefersCompletedResult(t *testing.T) {
	shutdownFailure := errors.New("shutdown completed with failure")
	for attempt := 0; attempt < 100; attempt++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		result := make(chan error, 1)
		result <- shutdownFailure

		if err := waitForShutdownResult(ctx, result); !errors.Is(err, shutdownFailure) {
			t.Fatalf("attempt %d: shutdown result = %v, want completed failure", attempt, err)
		}
	}
}

// TestWaitForServerResultPrefersCompletedResult verifies an available Server result wins over simultaneous Context cancellation.
func TestWaitForServerResultPrefersCompletedResult(t *testing.T) {
	serverFailure := errors.New("server completed with failure")
	for attempt := 0; attempt < 100; attempt++ {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		result := make(chan error, 1)
		result <- serverFailure

		serverErr, waitErr := waitForServerResult(ctx, result)
		if !errors.Is(serverErr, serverFailure) || waitErr != nil {
			t.Fatalf("attempt %d: server result = %v, wait error = %v; want completed failure", attempt, serverErr, waitErr)
		}
	}
}

// stubFactory returns a factory that always yields the supplied application.
func stubFactory(application serverApplication) applicationFactory {
	return func(context.Context, config.Config, *slog.Logger) (serverApplication, error) {
		return application, nil
	}
}

// testServerConfig returns a valid configuration without requiring real dependencies from the stub factory.
func testServerConfig() config.Config {
	return config.Config{
		Env:         "development",
		HTTPAddr:    ":0",
		DatabaseURL: "postgres://unused",
		StaticDir:   "web/dist",
	}
}

// testLogger returns an isolated structured logger and its captured output.
func testLogger() (*slog.Logger, *bytes.Buffer) {
	var output bytes.Buffer
	return slog.New(slog.NewTextHandler(&output, nil)), &output
}

// waitForTestSignal waits for a required test event without relying on the package timeout.
func waitForTestSignal(t *testing.T, signal <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(testLifecycleTimeout):
		t.Fatalf("timed out waiting for %s", operation)
	}
}

// waitForTestValue waits for a required test result without relying on the package timeout.
func waitForTestValue[T any](t *testing.T, values <-chan T, operation string) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-time.After(testLifecycleTimeout):
		t.Fatalf("timed out waiting for %s", operation)
		var zero T
		return zero
	}
}
