package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/config"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
)

// TestAppNewNormalizesEnvironment verifies application wiring uses the validated environment form.
func TestAppNewNormalizesEnvironment(t *testing.T) {
	ctx := context.Background()
	for _, test := range []struct {
		name       string
		env        string
		wantSecure bool
	}{
		{name: "production", env: " production ", wantSecure: true},
		{name: "development", env: "development", wantSecure: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			cfg := config.Config{
				Env:         test.env,
				HTTPAddr:    ":0",
				DatabaseURL: testdb.ProjectMigratedDatabaseURL(ctx, t),
				StaticDir:   "web/dist",
			}
			if err := cfg.Validate(); err != nil {
				t.Fatalf("validate config: %v", err)
			}
			application, err := New(ctx, cfg, slog.Default())
			if err != nil {
				t.Fatalf("build application: %v", err)
			}
			t.Cleanup(func() {
				if err := application.Shutdown(context.Background()); err != nil {
					t.Errorf("shutdown application: %v", err)
				}
			})
			if application.config.Env != test.name {
				t.Fatalf("environment = %q, want %q", application.config.Env, test.name)
			}

			if err := system.NewService(application.pool).Setup(ctx, system.SetupInput{
				AdminUsername:   "admin",
				AdminPassword:   "secure-password",
				AdminNickname:   "Administrator",
				SiteName:        "MoeURL",
				SystemDomain:    "example.com",
				ShortLinkDomain: "go.example.com",
				DefaultLanguage: "zh-CN",
				DefaultTheme:    "system",
			}); err != nil {
				t.Fatalf("initialize application: %v", err)
			}
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"username":"admin","password":"secure-password"}`))
			response := httptest.NewRecorder()
			application.server.Handler.ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("login status = %d", response.Code)
			}
			var body struct {
				Code int `json:"code"`
			}
			if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
				t.Fatalf("decode login response: %v", err)
			}
			if body.Code != 0 {
				t.Fatalf("login code = %d", body.Code)
			}
			cookies := response.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("expected one login cookie, got %d", len(cookies))
			}
			if cookies[0].Secure != test.wantSecure {
				t.Fatalf("login cookie secure = %t, want %t", cookies[0].Secure, test.wantSecure)
			}
		})
	}
}

// TestAppShutdownDrainsRequestsBeforeStoppingDependencies verifies shutdown ordering.
func TestAppShutdownDrainsRequestsBeforeStoppingDependencies(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})}
	shutdownStarted := make(chan struct{})
	server.RegisterOnShutdown(func() { close(shutdownStarted) })
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for shutdown test: %v", err)
	}
	serveDone := make(chan error, 1)
	go func() {
		serveDone <- server.Serve(listener)
	}()

	requestDone := make(chan error, 1)
	requestContext, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, "http://"+listener.Addr().String(), nil)
	if err != nil {
		t.Fatalf("create shutdown test request: %v", err)
	}
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		requestDone <- requestErr
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the test server")
	}

	cleanupCanceled := make(chan struct{})
	cleanupDone := make(chan struct{})
	go func() {
		<-cleanupCanceled
		close(cleanupDone)
	}()
	application := &App{
		server: server,
		grantCleanupCancel: func() {
			close(cleanupCanceled)
		},
		grantCleanupDone: cleanupDone,
	}
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), time.Second)
	defer cancelShutdown()
	shutdownDone := make(chan error, 1)
	go func() {
		shutdownDone <- application.Shutdown(shutdownContext)
	}()

	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped before HTTP shutdown started")
	case <-shutdownStarted:
	}
	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped while the in-flight request was running")
	default:
	}
	close(releaseRequest)
	if err := <-shutdownDone; err != nil {
		t.Fatalf("shutdown application: %v", err)
	}
	if err := <-requestDone; err != nil {
		t.Fatalf("complete in-flight request: %v", err)
	}
	if err := <-serveDone; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve result = %v, want http.ErrServerClosed", err)
	}
}

// TestAppShutdownFailureKeepsDependenciesRunning verifies a failed drain can be retried safely.
func TestAppShutdownFailureKeepsDependenciesRunning(t *testing.T) {
	requestStarted := make(chan struct{})
	releaseRequest := make(chan struct{})
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseRequest
		w.WriteHeader(http.StatusNoContent)
	})}
	listener, err := (&net.ListenConfig{}).Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen for failed shutdown test: %v", err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- server.Serve(listener) }()

	requestContext, cancelRequest := context.WithCancel(context.Background())
	defer cancelRequest()
	request, err := http.NewRequestWithContext(requestContext, http.MethodGet, "http://"+listener.Addr().String(), nil)
	if err != nil {
		t.Fatalf("create failed shutdown request: %v", err)
	}
	requestDone := make(chan error, 1)
	go func() {
		response, requestErr := http.DefaultClient.Do(request)
		if response != nil {
			_ = response.Body.Close()
		}
		requestDone <- requestErr
	}()
	select {
	case <-requestStarted:
	case <-time.After(time.Second):
		t.Fatal("request did not reach the failed shutdown test server")
	}

	cleanupCanceled := make(chan struct{})
	cleanupDone := make(chan struct{})
	close(cleanupDone)
	application := &App{
		server: server,
		grantCleanupCancel: func() {
			close(cleanupCanceled)
		},
		grantCleanupDone: cleanupDone,
	}
	shutdownContext, cancelShutdown := context.WithCancel(context.Background())
	cancelShutdown()
	if err := application.Shutdown(shutdownContext); !errors.Is(err, context.Canceled) {
		t.Fatalf("shutdown error = %v, want context.Canceled", err)
	}
	select {
	case <-cleanupCanceled:
		t.Fatal("cleanup stopped after HTTP shutdown failed")
	default:
	}

	close(releaseRequest)
	if err := <-requestDone; err != nil {
		t.Fatalf("complete failed-shutdown request: %v", err)
	}
	if err := <-serveDone; !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve result = %v, want http.ErrServerClosed", err)
	}
	if err := application.Shutdown(context.Background()); err != nil {
		t.Fatalf("retry shutdown application: %v", err)
	}
	select {
	case <-cleanupCanceled:
	default:
		t.Fatal("cleanup remained active after successful shutdown retry")
	}
}
