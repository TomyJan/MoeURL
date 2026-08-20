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
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/TomyJan/MoeURL/internal/usergroup"
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

// TestAppNewUsesDatabasePermissionsForUserService verifies application wiring applies user-group revocations to managed-user APIs.
func TestAppNewUsesDatabasePermissionsForUserService(t *testing.T) {
	ctx := context.Background()
	cfg := config.Config{
		Env:         "development",
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

	loginRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"username":"admin","password":"secure-password"}`))
	loginResponse := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(loginResponse, loginRequest)
	cookies := loginResponse.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one login cookie, got %d", len(cookies))
	}

	listCode := func() int {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user/list", nil)
		request.AddCookie(cookies[0])
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		var body struct {
			Code int `json:"code"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode user list response: %v", err)
		}
		return body.Code
	}
	if code := listCode(); code != 0 {
		t.Fatalf("initial user list code = %d, want 0", code)
	}
	if _, err := application.pool.Exec(ctx, `
		update user_group
		set permissions = permissions - 'admin:access'
		where key = 'admin'
	`); err != nil {
		t.Fatalf("revoke admin access: %v", err)
	}
	if code := listCode(); code != user.CodePermissionDenied {
		t.Fatalf("revoked user list code = %d, want %d", code, user.CodePermissionDenied)
	}
}

// TestAppNewUsesDatabasePermissionsForUserGroupService verifies user-group authorization is resolved for every new request.
func TestAppNewUsesDatabasePermissionsForUserGroupService(t *testing.T) {
	ctx := context.Background()
	cfg := config.Config{
		Env:         "development",
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

	var originalPermissions []byte
	var originalUpdatedAt time.Time
	if err := application.pool.QueryRow(ctx, `
		select permissions, updated_at
		from user_group
		where key = 'admin'
	`).Scan(&originalPermissions, &originalUpdatedAt); err != nil {
		t.Fatalf("read original admin group: %v", err)
	}
	t.Cleanup(func() {
		if _, err := application.pool.Exec(context.Background(), `
			update user_group
			set permissions = $1::jsonb, updated_at = $2
			where key = 'admin'
		`, originalPermissions, originalUpdatedAt); err != nil {
			t.Errorf("restore admin group: %v", err)
		}
	})

	loginRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"username":"admin","password":"secure-password"}`))
	loginResponse := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(loginResponse, loginRequest)
	cookies := loginResponse.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("expected one login cookie, got %d", len(cookies))
	}

	listCode := func() int {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/admin/user-group/list", nil)
		request.AddCookie(cookies[0])
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		var body struct {
			Code int `json:"code"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode user-group list response: %v", err)
		}
		return body.Code
	}
	if code := listCode(); code != 0 {
		t.Fatalf("initial user-group list code = %d, want 0", code)
	}
	if _, err := application.pool.Exec(ctx, `
		update user_group
		set permissions = permissions - 'admin:access'
		where key = 'admin'
	`); err != nil {
		t.Fatalf("revoke admin access: %v", err)
	}
	if code := listCode(); code != usergroup.CodePermissionDenied {
		t.Fatalf("revoked user-group list code = %d, want %d", code, usergroup.CodePermissionDenied)
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
	select {
	case <-cleanupCanceled:
	default:
		t.Fatal("grant cleanup was not canceled after shutdown")
	}
	select {
	case <-cleanupDone:
	default:
		t.Fatal("grant cleanup did not finish after shutdown")
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

// TestAppShutdownPrefersCompletedCleanupWhenContextIsDone verifies app shutdown prefers completed cleanup when context is done.
func TestAppShutdownPrefersCompletedCleanupWhenContextIsDone(t *testing.T) {
	for attempt := 0; attempt < 100; attempt++ {
		cleanupDone := make(chan struct{})
		close(cleanupDone)
		application := &App{
			server:             &http.Server{},
			grantCleanupCancel: func() {},
			grantCleanupDone:   cleanupDone,
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		if err := application.Shutdown(ctx); err != nil {
			t.Fatalf("attempt %d: shutdown error = %v, want nil after cleanup completed", attempt, err)
		}
	}
}

// TestAppShutdownStopsWaitingWhenCleanupExceedsDeadline verifies shutdown does not close the pool after cleanup times out.
func TestAppShutdownStopsWaitingWhenCleanupExceedsDeadline(t *testing.T) {
	cleanupCanceled := make(chan struct{})
	cleanupDone := make(chan struct{})
	application := &App{
		server: &http.Server{},
		grantCleanupCancel: func() {
			close(cleanupCanceled)
		},
		grantCleanupDone: cleanupDone,
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()

	err := application.Shutdown(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("shutdown error = %v, want context deadline exceeded", err)
	}
	select {
	case <-cleanupCanceled:
	default:
		t.Fatal("grant cleanup was not canceled")
	}
	select {
	case <-cleanupDone:
		t.Fatal("shutdown returned before grant cleanup completed")
	default:
	}
}
