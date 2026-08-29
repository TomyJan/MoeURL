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
	"strings"
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

const testSetupToken = "0123456789abcdef0123456789abcdef"

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
