package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/config"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/TomyJan/MoeURL/internal/usergroup"
)

const (
	testSetupToken       = "0123456789abcdef0123456789abcdef"
	testLifecycleTimeout = 5 * time.Second
)

// TestAppNewRejectsInvalidPermissionCatalog verifies startup stops before dependency wiring when catalog validation fails.
func TestAppNewRejectsInvalidPermissionCatalog(t *testing.T) {
	wantErr := errors.New("invalid permission catalog")
	originalValidate := validatePermissionCatalog
	validatePermissionCatalog = func() error { return wantErr }
	t.Cleanup(func() { validatePermissionCatalog = originalValidate })

	application, err := New(context.Background(), config.Config{HTTPAddr: ":0"}, slog.Default())
	if application != nil {
		t.Fatal("New() returned an application for an invalid permission catalog")
	}
	if !errors.Is(err, wantErr) {
		t.Fatalf("New() error = %v, want wrapped %v", err, wantErr)
	}
}

// TestAppNewRejectsInvalidSetupPolicyBeforeOpeningDatabase verifies invalid production policy fails closed.
func TestAppNewRejectsInvalidSetupPolicyBeforeOpeningDatabase(t *testing.T) {
	const invalidToken = "setup-token-shorter-than-32"
	application, err := New(context.Background(), config.Config{
		Env:         "production",
		DatabaseURL: "not-a-database-url",
		SetupToken:  invalidToken,
	}, slog.Default())

	if application != nil {
		t.Fatal("New() returned an application for an invalid setup policy")
	}
	if !errors.Is(err, system.ErrInvalidSetupPolicy) {
		t.Fatalf("New() error = %v, want ErrInvalidSetupPolicy", err)
	}
	if strings.Contains(err.Error(), invalidToken) {
		t.Fatal("New() error exposed the setup token")
	}
}

// TestAppNewPropagatesOpenPoolError verifies database startup errors retain their safe operation context.
func TestAppNewPropagatesOpenPoolError(t *testing.T) {
	application, err := New(context.Background(), config.Config{
		Env:         "development",
		HTTPAddr:    ":0",
		DatabaseURL: "postgres://user:top-secret@database.internal:invalid/moeurl",
	}, slog.Default())

	if application != nil {
		t.Fatal("New returned an application after OpenPool failed")
	}
	if err == nil || !strings.Contains(err.Error(), "parse database configuration") {
		t.Fatalf("New error = %v, want OpenPool parse context", err)
	}
	if strings.Contains(err.Error(), "top-secret") {
		t.Fatalf("New error leaked database credentials: %v", err)
	}
}

// TestAppNewConfiguresHTTPServerBoundaries verifies every production HTTP server limit.
func TestAppNewConfiguresHTTPServerBoundaries(t *testing.T) {
	application, err := New(context.Background(), config.Config{
		Env:      "development",
		HTTPAddr: ":8080",
	}, slog.Default())
	if err != nil {
		t.Fatalf("build application: %v", err)
	}

	if application.server.ReadHeaderTimeout != 5*time.Second {
		t.Fatalf("ReadHeaderTimeout = %s, want 5s", application.server.ReadHeaderTimeout)
	}
	if application.server.ReadTimeout != 15*time.Second {
		t.Fatalf("ReadTimeout = %s, want 15s", application.server.ReadTimeout)
	}
	if application.server.WriteTimeout != 30*time.Second {
		t.Fatalf("WriteTimeout = %s, want 30s", application.server.WriteTimeout)
	}
	if application.server.IdleTimeout != 60*time.Second {
		t.Fatalf("IdleTimeout = %s, want 60s", application.server.IdleTimeout)
	}
	if application.server.MaxHeaderBytes != 1<<20 {
		t.Fatalf("MaxHeaderBytes = %d, want %d", application.server.MaxHeaderBytes, 1<<20)
	}
}

// TestAppNewInjectsPoolAsReadinessChecker verifies production wiring reports the connected pool ready.
func TestAppNewInjectsPoolAsReadinessChecker(t *testing.T) {
	application := newTestApplication(t)
	response := httptest.NewRecorder()

	application.server.Handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/health/ready", nil))

	if response.Code != http.StatusOK {
		t.Fatalf("readiness status = %d, want 200", response.Code)
	}
	var body struct {
		Code int `json:"code"`
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode readiness response: %v", err)
	}
	if body.Code != 0 || body.Data.Status != "ok" {
		t.Fatalf("readiness response = code %d status %q", body.Code, body.Data.Status)
	}
}

// newTestApplication builds and initializes an application with an optional environment override.
func newTestApplication(t *testing.T, environments ...string) *App {
	t.Helper()
	if len(environments) > 1 {
		t.Fatalf("newTestApplication environments = %d, want at most 1", len(environments))
	}
	environment := "development"
	if len(environments) == 1 {
		environment = environments[0]
	}
	ctx := t.Context()
	cfg := config.Config{
		Env:         environment,
		HTTPAddr:    ":0",
		DatabaseURL: testdb.ProjectMigratedDatabaseURL(ctx, t),
		StaticDir:   "web/dist",
	}
	if environment == "production" || environment == " production " {
		cfg.SetupToken = testSetupToken
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
	setupPolicy, err := system.NewSetupPolicy(cfg.Env == "production", cfg.SetupToken)
	if err != nil {
		t.Fatalf("create setup policy: %v", err)
	}
	if err := system.NewService(application.pool, setupPolicy).Setup(ctx, system.SetupInput{
		AdminUsername:   "admin",
		AdminPassword:   "secure-password",
		AdminNickname:   "Administrator",
		SiteName:        "MoeURL",
		SystemDomain:    "example.com",
		ShortLinkDomain: "go.example.com",
		DefaultLanguage: "zh-CN",
		DefaultTheme:    "system",
		SetupToken:      cfg.SetupToken,
	}); err != nil {
		t.Fatalf("initialize application: %v", err)
	}
	return application
}

// TestAppNewInjectsProductionSetupPolicy verifies app wiring enforces the validated deployment token.
func TestAppNewInjectsProductionSetupPolicy(t *testing.T) {
	ctx := t.Context()
	cfg := config.Config{
		Env:         "production",
		HTTPAddr:    ":0",
		DatabaseURL: testdb.ProjectMigratedDatabaseURL(ctx, t),
		StaticDir:   "web/dist",
		SetupToken:  testSetupToken,
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

	statusResponse := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(statusResponse, httptest.NewRequestWithContext(ctx, http.MethodGet, "/api/v1/init/status", nil))
	var statusBody struct {
		Code int `json:"code"`
		Data struct {
			SetupTokenRequired bool `json:"setupTokenRequired"`
		} `json:"data"`
	}
	if err := json.NewDecoder(statusResponse.Body).Decode(&statusBody); err != nil {
		t.Fatalf("decode status response: %v", err)
	}
	if statusBody.Code != 0 || !statusBody.Data.SetupTokenRequired {
		t.Fatalf("status code = %d, setupTokenRequired = %t", statusBody.Code, statusBody.Data.SetupTokenRequired)
	}

	setupResponse := httptest.NewRecorder()
	setupRequest := httptest.NewRequestWithContext(ctx, http.MethodPost, "/api/v1/init/setup", bytes.NewBufferString(`{
		"adminUsername":"admin",
		"adminPassword":"secure-password",
		"adminNickname":"Administrator",
		"siteName":"MoeURL",
		"systemDomain":"example.com",
		"shortLinkDomain":"go.example.com",
		"defaultLanguage":"zh-CN",
		"defaultTheme":"system",
		"setupToken":"`+testSetupToken+`"
	}`))
	application.server.Handler.ServeHTTP(setupResponse, setupRequest)
	var setupBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(setupResponse.Body).Decode(&setupBody); err != nil {
		t.Fatalf("decode setup response: %v", err)
	}
	if setupResponse.Code != http.StatusOK || setupBody.Code != 0 {
		t.Fatalf("setup response = HTTP %d, code %d", setupResponse.Code, setupBody.Code)
	}
}

// TestAppNewNormalizesEnvironment verifies application wiring uses the validated environment form.
func TestAppNewNormalizesEnvironment(t *testing.T) {
	for _, test := range []struct {
		name       string
		env        string
		wantSecure bool
	}{
		{name: "production", env: " production ", wantSecure: true},
		{name: "development", env: "development", wantSecure: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			application := newTestApplication(t, test.env)
			if application.config.Env != test.name {
				t.Fatalf("environment = %q, want %q", application.config.Env, test.name)
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
	ctx := t.Context()
	application := newTestApplication(t)

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
	ctx := t.Context()
	application := newTestApplication(t)

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
	var loginBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(loginResponse.Body).Decode(&loginBody); err != nil {
		t.Fatalf("decode admin login response: %v", err)
	}
	if loginResponse.Code != http.StatusOK || loginBody.Code != 0 {
		t.Fatalf("admin login response = HTTP %d, code %d", loginResponse.Code, loginBody.Code)
	}
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

// TestAppAppliesUserPermissionChangesToNewRequests verifies runtime revocation and restoration use fresh database snapshots.
func TestAppAppliesUserPermissionChangesToNewRequests(t *testing.T) {
	application := newTestApplication(t)

	login := func(username string, password string) (*http.Cookie, auth.CurrentUser) {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/auth/login", bytes.NewBufferString(`{"username":"`+username+`","password":"`+password+`"}`))
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		var body struct {
			Code int `json:"code"`
			Data struct {
				User auth.CurrentUser `json:"user"`
			} `json:"data"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode %s login response: %v", username, err)
		}
		if response.Code != http.StatusOK || body.Code != 0 {
			t.Fatalf("%s login response = HTTP %d, code %d", username, response.Code, body.Code)
		}
		cookies := response.Result().Cookies()
		if len(cookies) != 1 {
			t.Fatalf("%s login cookies = %d, want 1", username, len(cookies))
		}
		return cookies[0], body.Data.User
	}

	adminCookie, adminActor := login("admin", "secure-password")
	createUserRequest := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user/create", bytes.NewBufferString(`{
		"username":"member",
		"password":"member-password",
		"nickname":"Member",
		"groupKey":"user",
		"status":"active"
	}`))
	createUserRequest.AddCookie(adminCookie)
	createUserResponse := httptest.NewRecorder()
	application.server.Handler.ServeHTTP(createUserResponse, createUserRequest)
	var createUserBody struct {
		Code int `json:"code"`
	}
	if err := json.NewDecoder(createUserResponse.Body).Decode(&createUserBody); err != nil {
		t.Fatalf("decode user create response: %v", err)
	}
	if createUserResponse.Code != http.StatusOK || createUserBody.Code != 0 {
		t.Fatalf("user create response = HTTP %d, code %d", createUserResponse.Code, createUserBody.Code)
	}
	memberCookie, _ := login("member", "member-password")

	createIntermediateCode := func(targetURL string) int {
		t.Helper()
		request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/create", bytes.NewBufferString(`{
			"targetUrl":"`+targetURL+`",
			"redirectMode":"intermediate",
			"intermediateDelaySeconds":3
		}`))
		request.AddCookie(memberCookie)
		response := httptest.NewRecorder()
		application.server.Handler.ServeHTTP(response, request)
		var body struct {
			Code int `json:"code"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatalf("decode short-link create response: %v", err)
		}
		if response.Code != http.StatusOK {
			t.Fatalf("short-link create HTTP status = %d", response.Code)
		}
		return body.Code
	}
	if code := createIntermediateCode("https://example.com/before-revocation"); code != 0 {
		t.Fatalf("initial short-link create code = %d, want 0", code)
	}

	groupService := usergroup.NewService(application.pool, permission.NewDatabaseService(application.pool))
	listGroups := func(ctx context.Context) usergroup.ListResult {
		t.Helper()
		result, err := groupService.List(ctx, adminActor)
		if err != nil {
			t.Fatalf("list user groups: %v", err)
		}
		return result
	}
	findUserGroup := func(result usergroup.ListResult) usergroup.UserGroup {
		t.Helper()
		for _, group := range result.Groups {
			if group.Key == permission.GroupUser {
				return group
			}
		}
		t.Fatal("user group was not returned")
		return usergroup.UserGroup{}
	}
	originalGroup := findUserGroup(listGroups(t.Context()))
	restorePermissions := func() {
		restoreContext, cancelRestore := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelRestore()
		latest := findUserGroup(listGroups(restoreContext))
		if _, err := groupService.UpdatePermissions(restoreContext, adminActor, usergroup.UpdatePermissionsInput{
			GroupKey:          permission.GroupUser,
			Permissions:       originalGroup.Permissions,
			ExpectedUpdatedAt: latest.UpdatedAt,
		}); err != nil {
			t.Errorf("restore user permissions: %v", err)
		}
	}
	t.Cleanup(restorePermissions)

	revokedPermissions := make([]string, 0, len(originalGroup.Permissions))
	for _, permissionKey := range originalGroup.Permissions {
		if permissionKey != permission.ShortLinkUseIntermediate {
			revokedPermissions = append(revokedPermissions, permissionKey)
		}
	}
	revoked, err := groupService.UpdatePermissions(t.Context(), adminActor, usergroup.UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       revokedPermissions,
		ExpectedUpdatedAt: originalGroup.UpdatedAt,
	})
	if err != nil {
		t.Fatalf("revoke intermediate permission: %v", err)
	}
	if code := createIntermediateCode("https://example.com/after-revocation"); code != shortlink.CodePermissionDenied {
		t.Fatalf("revoked short-link create code = %d, want %d", code, shortlink.CodePermissionDenied)
	}

	if _, err := groupService.UpdatePermissions(t.Context(), adminActor, usergroup.UpdatePermissionsInput{
		GroupKey:          permission.GroupUser,
		Permissions:       originalGroup.Permissions,
		ExpectedUpdatedAt: revoked.Group.UpdatedAt,
	}); err != nil {
		t.Fatalf("restore intermediate permission: %v", err)
	}
	if code := createIntermediateCode("https://example.com/after-restoration"); code != 0 {
		t.Fatalf("restored short-link create code = %d, want 0", code)
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
	waitForAppTestSignal(t, requestStarted, "request to reach the test server")

	cleanupCanceled := make(chan struct{})
	cancelBackground, backgroundDone := startBackgroundTasks(func(ctx context.Context) {
		<-ctx.Done()
		close(cleanupCanceled)
	})
	application := &App{
		server:           server,
		backgroundCancel: cancelBackground,
		backgroundDone:   backgroundDone,
	}
	shutdownContext, cancelShutdown := context.WithTimeout(context.Background(), time.Second)
	defer cancelShutdown()
	shutdownDone := make(chan error, 1)
	go func() {
		shutdownDone <- application.Shutdown(shutdownContext)
	}()

	waitForAppTestSignal(t, shutdownStarted, "HTTP shutdown to start")
	assertAppTestSignalPending(t, cleanupCanceled, "cleanup cancellation while the in-flight request was running")
	close(releaseRequest)
	if err := waitForAppTestValue(t, shutdownDone, "application shutdown"); err != nil {
		t.Fatalf("shutdown application: %v", err)
	}
	if err := waitForAppTestValue(t, requestDone, "in-flight request completion"); err != nil {
		t.Fatalf("complete in-flight request: %v", err)
	}
	if err := waitForAppTestValue(t, serveDone, "HTTP Server exit"); !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("serve result = %v, want http.ErrServerClosed", err)
	}
	waitForAppTestSignal(t, cleanupCanceled, "grant cleanup cancellation")
	waitForAppTestSignal(t, backgroundDone, "background task group completion")
}

// TestAppShutdownFailureStillCleansDependencies verifies an HTTP drain failure cannot skip later lifecycle stages.
func TestAppShutdownFailureStillCleansDependencies(t *testing.T) {
	httpFailure := errors.New("drain failed")
	var eventsMu sync.Mutex
	var events []string
	record := func(event string) {
		eventsMu.Lock()
		defer eventsMu.Unlock()
		events = append(events, event)
	}
	cancelBackground, backgroundDone := startBackgroundTasks(func(ctx context.Context) {
		<-ctx.Done()
		record("cancel background")
		record("wait background")
	})
	application := &App{
		backgroundCancel: cancelBackground,
		backgroundDone:   backgroundDone,
		shutdownHTTP: func(context.Context) error {
			record("drain HTTP")
			return httpFailure
		},
		closePool: func() {
			record("close pool")
		},
	}

	err := application.Shutdown(context.Background())
	if !errors.Is(err, httpFailure) {
		t.Fatalf("shutdown error = %v, want HTTP drain failure", err)
	}
	eventsMu.Lock()
	defer eventsMu.Unlock()
	want := []string{"drain HTTP", "cancel background", "wait background", "close pool"}
	if len(events) != len(want) {
		t.Fatalf("shutdown events = %v, want %v", events, want)
	}
	for index := range want {
		if events[index] != want[index] {
			t.Fatalf("shutdown events = %v, want %v", events, want)
		}
	}
}

// TestAppShutdownWaitsForAllBackgroundTasks verifies Pool closure follows every task exit.
func TestAppShutdownWaitsForAllBackgroundTasks(t *testing.T) {
	taskCanceled := []chan struct{}{make(chan struct{}), make(chan struct{})}
	releaseTask := []chan struct{}{make(chan struct{}), make(chan struct{})}
	taskExited := []chan struct{}{make(chan struct{}), make(chan struct{})}
	tasks := make([]func(context.Context), 0, len(taskCanceled))
	for index := range taskCanceled {
		index := index
		tasks = append(tasks, func(ctx context.Context) {
			<-ctx.Done()
			close(taskCanceled[index])
			<-releaseTask[index]
			close(taskExited[index])
		})
	}
	cancelBackground, backgroundDone := startBackgroundTasks(tasks...)
	poolClosed := make(chan struct{})
	application := &App{
		backgroundCancel: cancelBackground,
		backgroundDone:   backgroundDone,
		shutdownHTTP:     func(context.Context) error { return nil },
		closePool:        func() { close(poolClosed) },
	}
	shutdownResult := make(chan error, 1)
	go func() { shutdownResult <- application.Shutdown(context.Background()) }()

	for index := range taskCanceled {
		waitForAppTestSignal(t, taskCanceled[index], fmt.Sprintf("background task %d cancellation", index))
	}
	assertAppTestSignalPending(t, poolClosed, "Pool closure before all background tasks exited")
	for index := range releaseTask {
		close(releaseTask[index])
	}
	if err := waitForAppTestValue(t, shutdownResult, "application shutdown"); err != nil {
		t.Fatalf("shutdown application: %v", err)
	}
	for index := range taskExited {
		waitForAppTestSignal(t, taskExited[index], fmt.Sprintf("background task %d exit", index))
	}
	waitForAppTestSignal(t, poolClosed, "Pool closure after all background tasks exited")
}

// TestAppShutdownIsIdempotent verifies repeated calls execute lifecycle effects once and return the same result.
func TestAppShutdownIsIdempotent(t *testing.T) {
	shutdownFailure := errors.New("drain failed")
	backgroundDone := make(chan struct{})
	close(backgroundDone)
	var drainCalls int
	var cancelCalls int
	var poolCloseCalls int
	application := &App{
		backgroundCancel: func() { cancelCalls++ },
		backgroundDone:   backgroundDone,
		shutdownHTTP: func(context.Context) error {
			drainCalls++
			return shutdownFailure
		},
		closePool: func() { poolCloseCalls++ },
	}

	first := application.Shutdown(context.Background())
	second := application.Shutdown(context.Background())
	if first != second {
		t.Fatalf("repeated shutdown errors differ: first %v, second %v", first, second)
	}
	if !errors.Is(first, shutdownFailure) {
		t.Fatalf("shutdown error = %v, want drain failure", first)
	}
	if drainCalls != 1 || cancelCalls != 1 || poolCloseCalls != 1 {
		t.Fatalf("lifecycle calls = drain %d, cancel %d, pool %d; want each once", drainCalls, cancelCalls, poolCloseCalls)
	}
}

// TestAppShutdownAllowsPartialInitialization verifies nil lifecycle dependencies are safe and repeatable.
func TestAppShutdownAllowsPartialInitialization(t *testing.T) {
	application := &App{}
	if err := application.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown partial application: %v", err)
	}
	if err := application.Shutdown(context.Background()); err != nil {
		t.Fatalf("repeat shutdown partial application: %v", err)
	}
}

// TestAppShutdownPrefersCompletedBackgroundTasksWhenContextIsDone verifies a finished group does not manufacture a timeout error.
func TestAppShutdownPrefersCompletedBackgroundTasksWhenContextIsDone(t *testing.T) {
	for attempt := 0; attempt < 100; attempt++ {
		backgroundDone := make(chan struct{})
		close(backgroundDone)
		application := &App{
			backgroundCancel: func() {},
			backgroundDone:   backgroundDone,
			shutdownHTTP:     func(context.Context) error { return nil },
		}
		ctx, cancel := context.WithCancel(context.Background())
		cancel()

		if err := application.Shutdown(ctx); err != nil {
			t.Fatalf("attempt %d: shutdown error = %v, want nil after background completion", attempt, err)
		}
	}
}

// TestAppShutdownTimeoutStillClosesPool verifies deadline errors remain inspectable and cannot skip Pool closure.
func TestAppShutdownTimeoutStillClosesPool(t *testing.T) {
	httpFailure := errors.New("drain failed")
	backgroundStarted := make(chan struct{})
	backgroundCanceled := make(chan struct{})
	releaseBackground := make(chan struct{})
	cancelBackground, backgroundDone := startBackgroundTasks(func(ctx context.Context) {
		close(backgroundStarted)
		<-ctx.Done()
		close(backgroundCanceled)
		<-releaseBackground
	})
	poolClosed := make(chan struct{})
	application := &App{
		backgroundCancel: cancelBackground,
		backgroundDone:   backgroundDone,
		shutdownHTTP:     func(context.Context) error { return httpFailure },
		closePool:        func() { close(poolClosed) },
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	waitForAppTestSignal(t, backgroundStarted, "background task start")

	err := application.Shutdown(ctx)
	if !errors.Is(err, httpFailure) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("shutdown error = %v, want joined drain failure and context deadline exceeded", err)
	}
	waitForAppTestSignal(t, backgroundCanceled, "background task cancellation")
	waitForAppTestSignal(t, poolClosed, "Pool closure after background wait timeout")
	close(releaseBackground)
	waitForAppTestSignal(t, backgroundDone, "background task completion")
}

// waitForAppTestSignal waits for a required lifecycle event without relying on the package timeout.
func waitForAppTestSignal(t *testing.T, signal <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-signal:
	case <-time.After(testLifecycleTimeout):
		t.Fatalf("timed out waiting for %s", operation)
	}
}

// waitForAppTestValue waits for a required lifecycle result without relying on the package timeout.
func waitForAppTestValue[T any](t *testing.T, values <-chan T, operation string) T {
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

// assertAppTestSignalPending checks non-occurrence only after the caller establishes a synchronization point.
func assertAppTestSignalPending(t *testing.T, signal <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-signal:
		t.Fatalf("unexpected %s", operation)
	default:
	}
}
