package auth

import (
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// passwordFixture creates isolated real account and session fixtures.
func passwordFixture(t *testing.T) (*pgxpool.Pool, *Service, string) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	hash, err := HashPassword(" old <&密码> ")
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000000001','user','User','[]',true,now(),now()); insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000000002','guest','Guest','[]',true,now(),now())`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,password_hash,group_id,status,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000000101','alice','Alice',$1,'00000000-0000-0000-0000-000000000001','active',false,now(),now()), ('00000000-0000-0000-0000-000000000102','bob','Bob',$1,'00000000-0000-0000-0000-000000000001','active',false,now(),now())`, hash)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(t.Context(), `insert into session(id,user_id,expires_at,last_seen_at,created_at) values ('current','00000000-0000-0000-0000-000000000101',now()+interval '1 hour',now(),now()), ('other-device','00000000-0000-0000-0000-000000000101',now()+interval '1 hour',now(),now()), ('other-user','00000000-0000-0000-0000-000000000102',now()+interval '1 hour',now(),now())`)
	if err != nil {
		t.Fatal(err)
	}
	return pool, NewService(pool, time.Hour), hash
}

// passwordQueryTracer controls real PostgreSQL query boundaries without replacing query results.
type passwordQueryTracer struct {
	start func(context.Context, string) context.Context
	end   func(string)
}
type passwordQueryKey struct{}

// TraceQueryStart applies deterministic synchronization or cancellation to the selected real query.
func (tracer passwordQueryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if tracer.start != nil {
		ctx = tracer.start(ctx, data.SQL)
	}
	return context.WithValue(ctx, passwordQueryKey{}, data.SQL)
}

// TraceQueryEnd notifies the test after the real query has completed.
func (tracer passwordQueryTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, _ pgx.TraceQueryEndData) {
	if tracer.end != nil {
		tracer.end(ctx.Value(passwordQueryKey{}).(string))
	}
}

// passwordTracedService opens a bounded pool against the same isolated fixture database.
func passwordTracedService(t *testing.T, pool *pgxpool.Pool, tracer passwordQueryTracer) *Service {
	t.Helper()
	config := pool.Config()
	config.MaxConns = 1
	config.ConnConfig.Tracer = tracer
	traced, err := pgxpool.NewWithConfig(t.Context(), config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(traced.Close)
	return NewService(traced, time.Hour)
}

// TestPasswordChangeInfrastructureRollback verifies every transactional failure preserves original credentials, sessions, and failure state.
func TestPasswordChangeInfrastructureRollback(t *testing.T) {
	for _, tt := range []struct {
		name, query string
		wrong       bool
	}{
		{"account lookup", "GetPasswordAccountBySession", false}, {"begin", "begin", false},
		{"attempt lock", "GetAuthLoginAttemptForUpdate", false}, {"user lock", "GetPasswordAccountForUpdate", false},
		{"session lock", "GetPasswordSessionForUpdate", false}, {"failure record", "RecordAuthLoginFailure", true},
		{"audit context", "set_config", false},
		{"failure commit", "commit", true}, {"password update", "UpdateOwnPassword", false},
		{"session revoke", "RevokePasswordUserSessions", false}, {"attempt delete", "DeleteAuthLoginAttempt", false},
		{"success commit", "commit", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			pool, _, originalHash := passwordFixture(t)
			if _, err := pool.Exec(t.Context(), `insert into auth_login_attempt(username_hash,failed_attempts,window_started_at,updated_at) values($1,3,now(),now())`, hashLoginUsername("alice")); err != nil {
				t.Fatal(err)
			}
			hit := false
			service := passwordTracedService(t, pool, passwordQueryTracer{start: func(ctx context.Context, query string) context.Context {
				if strings.Contains(query, tt.query) {
					hit = true
					c, cancel := context.WithCancel(ctx)
					cancel()
					return c
				}
				return ctx
			}})
			current := " old <&密码> "
			if tt.wrong {
				current = "wrong"
			}
			ctx, cancel := context.WithCancel(t.Context())
			cancel()
			if err := service.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: current, NewPassword: "new-password"}); err == nil || errors.Is(err, ErrInvalidCredentials) || errors.Is(err, ErrLoginRateLimited) {
				t.Fatalf("expected infrastructure error, got %v", err)
			}
			if !hit {
				t.Fatal("target query not reached")
			}
			assertPasswordState(t, pool, originalHash, 3)
		})
	}
}

// assertPasswordState proves rollback restored all three security-relevant persistent values.
func assertPasswordState(t *testing.T, pool *pgxpool.Pool, hash string, attempts int) {
	t.Helper()
	var actualHash string
	var actualAttempts, revoked int
	if err := pool.QueryRow(t.Context(), `select password_hash from app_user where username='alice'`).Scan(&actualHash); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `select failed_attempts from auth_login_attempt where username_hash=$1`, hashLoginUsername("alice")).Scan(&actualAttempts); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `select count(*) from session where revoked_at is not null`).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if actualHash != hash || actualAttempts != attempts || revoked != 0 {
		t.Fatalf("partial write: hashChanged=%t attempts=%d revoked=%d", actualHash != hash, actualAttempts, revoked)
	}
}

// TestPasswordStatusInfrastructureError verifies a closed database remains an infrastructure error.
func TestPasswordStatusInfrastructureError(t *testing.T) {
	pool, service, _ := passwordFixture(t)
	pool.Close()
	if _, err := service.PasswordStatus(t.Context(), "current"); err == nil || errors.Is(err, ErrInvalidSession) {
		t.Fatalf("status=%v", err)
	}
}

// TestPasswordChangeHashFailureRollback verifies entropy failure cannot revoke sessions or change credentials.
func TestPasswordChangeHashFailureRollback(t *testing.T) {
	pool, service, hash := passwordFixture(t)
	if _, err := pool.Exec(t.Context(), `insert into auth_login_attempt(username_hash,failed_attempts,window_started_at,updated_at) values($1,2,now(),now())`, hashLoginUsername("alice")); err != nil {
		t.Fatal(err)
	}
	previous := passwordRandomReader
	passwordRandomReader = strings.NewReader("")
	t.Cleanup(func() { passwordRandomReader = previous })
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}); !errors.Is(err, io.EOF) {
		t.Fatalf("hash failure=%v", err)
	}
	assertPasswordState(t, pool, hash, 2)
}

// TestPasswordChangeRechecksIdentityAfterInitialLookup verifies races with disablement, deletion, and session revocation fail safely.
func TestPasswordChangeRechecksIdentityAfterInitialLookup(t *testing.T) {
	for _, tt := range []struct{ name, mutation string }{
		{"disabled", `update app_user set status='disabled' where username='alice'`},
		{"deleted", `update app_user set deleted_at=now() where username='alice'`},
		{"builtin", `update app_user set builtin=true where username='alice'`},
		{"guest", `update app_user set group_id='00000000-0000-0000-0000-000000000002' where username='alice'`},
		{"revoked", `update session set revoked_at=now() where id='current'`},
		{"expired", `update session set expires_at=clock_timestamp() where id='current'`},
		{"reassigned", `update session set user_id='00000000-0000-0000-0000-000000000102' where id='current'`},
	} {
		t.Run(tt.name, func(t *testing.T) {
			pool, _, _ := passwordFixture(t)
			var once sync.Once
			service := passwordTracedService(t, pool, passwordQueryTracer{end: func(query string) {
				if strings.Contains(query, "GetPasswordAccountBySession") {
					once.Do(func() {
						if _, err := pool.Exec(t.Context(), tt.mutation); err != nil {
							t.Fatal(err)
						}
					})
				}
			}})
			if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}); !errors.Is(err, ErrInvalidSession) {
				t.Fatalf("race=%v", err)
			}
		})
	}
}

// TestPasswordChangeSharedAdmission verifies both process-wide admission boundaries are shared with login.
func TestPasswordChangeSharedAdmission(t *testing.T) {
	pool, service, _ := passwordFixture(t)
	for range cap(service.loginSlots) {
		service.loginSlots <- struct{}{}
	}
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: "old", NewPassword: "new-password"}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("global admission=%v", err)
	}
	for range cap(service.loginSlots) {
		<-service.loginSlots
	}
	for range cap(service.passwordVerificationSlots) {
		service.passwordVerificationSlots <- struct{}{}
	}
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: "old", NewPassword: "new-password"}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("argon admission=%v", err)
	}
	for range cap(service.passwordVerificationSlots) {
		<-service.passwordVerificationSlots
	}
	var attempts int
	if err := pool.QueryRow(t.Context(), `select count(*) from auth_login_attempt`).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("admission persisted attempts=%d", attempts)
	}
}

// waitForPasswordLock waits for a real blocked transaction instead of assuming scheduling order.
func waitForPasswordLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		if err := pool.QueryRow(ctx, `select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and state='active' and pid<>pg_backend_pid()`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count > 0 {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatal("transaction did not reach lock wait")
		}
	}
}

// TestPasswordChangeConcurrentRepeatedChangeRejectsStaleSession verifies only the first transaction may use the original session.
func TestPasswordChangeConcurrentRepeatedChangeRejectsStaleSession(t *testing.T) {
	pool, first, _ := passwordFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	first.verifyPassword = func(password, hash string) bool { close(entered); <-release; return VerifyPassword(password, hash) }
	firstResult := make(chan error, 1)
	go func() {
		firstResult <- first.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "first-new-password"})
	}()
	waitForInternalAuthSignal(t, ctx, entered, "first change verifier")
	lookupComplete := make(chan struct{})
	var lookupOnce sync.Once
	second := passwordTracedService(t, pool, passwordQueryTracer{end: func(query string) {
		if strings.Contains(query, "GetPasswordAccountBySession") {
			lookupOnce.Do(func() { close(lookupComplete) })
		}
	}})
	second.verifyPassword = func(string, string) bool { t.Error("stale session reached password verification"); return true }
	secondResult := make(chan error, 1)
	go func() {
		secondResult <- second.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "second-new-password"})
	}()
	waitForInternalAuthSignal(t, ctx, lookupComplete, "second initial lookup")
	waitForPasswordLock(t, ctx, pool)
	unblock()
	if err := waitForInternalAuthValue(t, ctx, firstResult, "first change"); err != nil {
		t.Fatal(err)
	}
	if err := waitForInternalAuthValue(t, ctx, secondResult, "second change"); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("stale session=%v", err)
	}
	var hash string
	if err := pool.QueryRow(ctx, `select password_hash from app_user where username='alice'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if !VerifyPassword("first-new-password", hash) {
		t.Fatal("second change overwrote password")
	}
}

// TestPasswordChangeConcurrentLogin verifies either commit order leaves no old-password session alive.
func TestPasswordChangeConcurrentLogin(t *testing.T) {
	for _, loginFirst := range []bool{true, false} {
		name := "change first"
		if loginFirst {
			name = "login first"
		}
		t.Run(name, func(t *testing.T) {
			pool, service, _ := passwordFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			entered := make(chan struct{})
			release := make(chan struct{})
			var once sync.Once
			unblock := func() { once.Do(func() { close(release) }) }
			defer unblock()
			first := NewServiceWithPasswordVerifier(pool, time.Hour, func(password, hash string) bool { close(entered); <-release; return VerifyPassword(password, hash) })
			firstResult := make(chan error, 1)
			secondResult := make(chan error, 1)
			login := func(s *Service, ch chan error) {
				_, err := s.Login(ctx, LoginInput{Username: "alice", Password: " old <&密码> "})
				ch <- err
			}
			change := func(s *Service, ch chan error) {
				ch <- s.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"})
			}
			if loginFirst {
				go login(first, firstResult)
			} else {
				go change(first, firstResult)
			}
			waitForInternalAuthSignal(t, ctx, entered, "first operation verifier")
			if loginFirst {
				go change(service, secondResult)
			} else {
				go login(service, secondResult)
			}
			waitForPasswordLock(t, ctx, pool)
			unblock()
			if err := waitForInternalAuthValue(t, ctx, firstResult, "first operation"); err != nil {
				t.Fatal(err)
			}
			want := error(nil)
			if !loginFirst {
				want = ErrInvalidCredentials
			}
			if err := waitForInternalAuthValue(t, ctx, secondResult, "second operation"); !errors.Is(err, want) {
				t.Fatalf("second operation=%v want=%v", err, want)
			}
			var alive int
			if err := pool.QueryRow(ctx, `select count(*) from session where user_id='00000000-0000-0000-0000-000000000101' and revoked_at is null`).Scan(&alive); err != nil {
				t.Fatal(err)
			}
			if alive != 0 {
				t.Fatalf("old password sessions alive=%d", alive)
			}
		})
	}
}

// passwordBlockingReader pauses salt generation to prove the verification slot covers new hashing too.
type passwordBlockingReader struct {
	entered chan struct{}
	release <-chan struct{}
	source  io.Reader
}

// Read announces the salt request and then delegates to cryptographic entropy after release.
func (reader passwordBlockingReader) Read(buffer []byte) (int, error) {
	close(reader.entered)
	<-reader.release
	return reader.source.Read(buffer)
}

// TestPasswordChangeHoldsSharedArgonSlotThroughHash verifies login cannot bypass the combined verifier/hash concurrency bound.
func TestPasswordChangeHoldsSharedArgonSlotThroughHash(t *testing.T) {
	pool, service, _ := passwordFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	service.passwordVerificationSlots <- struct{}{}
	entered := make(chan struct{})
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	defer unblock()
	previous := passwordRandomReader
	passwordRandomReader = passwordBlockingReader{entered: entered, release: release, source: previous}
	t.Cleanup(func() { passwordRandomReader = previous })
	result := make(chan error, 1)
	go func() {
		result <- service.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"})
	}()
	waitForInternalAuthSignal(t, ctx, entered, "new hash entropy")
	if _, err := service.Login(ctx, LoginInput{Username: "bob", Password: " old <&密码> "}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("login during hashing=%v", err)
	}
	unblock()
	if err := waitForInternalAuthValue(t, ctx, result, "password hash"); err != nil {
		t.Fatal(err)
	}
	<-service.passwordVerificationSlots
	if _, err := service.Login(ctx, LoginInput{Username: "bob", Password: " old <&密码> "}); err != nil {
		t.Fatal(err)
	}
	var attempts int
	if err := pool.QueryRow(ctx, `select count(*) from auth_login_attempt`).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatal("rejected admission persisted attempts")
	}
}

// TestPasswordChangePreservesValuesAndRevokesAllSessions verifies the complete local credential transition.
func TestPasswordChangePreservesValuesAndRevokesAllSessions(t *testing.T) {
	pool, service, oldHash := passwordFixture(t)
	status, err := service.PasswordStatus(t.Context(), "current")
	if err != nil || !status.CanChangePassword {
		t.Fatalf("status = %+v, %v", status, err)
	}
	newPassword := " new <&密码>  "
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: newPassword}); err != nil {
		t.Fatal(err)
	}
	var hash string
	var revoked, unaffected int
	if err := pool.QueryRow(t.Context(), `select password_hash from app_user where username='alice'`).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash == oldHash || !VerifyPassword(newPassword, hash) || VerifyPassword(strings.TrimSpace(newPassword), hash) {
		t.Fatal("password value was altered or hash unchanged")
	}
	if err := pool.QueryRow(t.Context(), `select count(*) from session where user_id='00000000-0000-0000-0000-000000000101' and revoked_at is not null`).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(t.Context(), `select count(*) from session where id='other-user' and revoked_at is null`).Scan(&unaffected); err != nil {
		t.Fatal(err)
	}
	if revoked != 2 || unaffected != 1 {
		t.Fatalf("revoked=%d unaffected=%d", revoked, unaffected)
	}
	if _, err := service.Login(t.Context(), LoginInput{Username: "alice", Password: " old <&密码> "}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("old login=%v", err)
	}
	if _, err := service.Login(t.Context(), LoginInput{Username: "alice", Password: newPassword}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.PasswordStatus(t.Context(), "current"); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("revoked status=%v", err)
	}
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: newPassword, NewPassword: "another-password"}); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("revoked change=%v", err)
	}
}

// TestPasswordChangeValidatesRawUnicode verifies byte/rune boundaries without normalizing credentials.
func TestPasswordChangeValidatesRawUnicode(t *testing.T) {
	service := NewService(nil, time.Hour)
	for _, input := range []ChangePasswordInput{
		{NewPassword: "new-password"}, {CurrentPassword: strings.Repeat("a", 4097), NewPassword: "new-password"},
		{CurrentPassword: "\xff", NewPassword: "new-password"}, {CurrentPassword: "old", NewPassword: "\xff12345678"},
		{CurrentPassword: "old", NewPassword: "1234567"}, {CurrentPassword: "old", NewPassword: strings.Repeat("界", 129)},
		{CurrentPassword: "same-password", NewPassword: "same-password"},
	} {
		if err := service.ChangePassword(t.Context(), "current", input); !errors.Is(err, ErrInvalidPasswordInput) {
			t.Fatalf("input rejected with %v", err)
		}
	}
	for _, input := range []ChangePasswordInput{{CurrentPassword: " ", NewPassword: strings.Repeat("界", 8)}, {CurrentPassword: strings.Repeat("a", 4096), NewPassword: strings.Repeat("界", 128)}} {
		if err := service.ChangePassword(t.Context(), "", input); !errors.Is(err, ErrInvalidSession) {
			t.Fatalf("valid boundary=%v", err)
		}
	}
}

// TestPasswordChangeRejectsIneligibleIdentity verifies session and account restrictions for both endpoints.
func TestPasswordChangeRejectsIneligibleIdentity(t *testing.T) {
	tests := []struct {
		name, sql string
		want      error
		available bool
	}{
		{name: "missing", sql: `delete from session where id='current'`, want: ErrInvalidSession},
		{name: "expired", sql: `update session set expires_at=clock_timestamp() where id='current'`, want: ErrInvalidSession},
		{name: "revoked", sql: `update session set revoked_at=now() where id='current'`, want: ErrInvalidSession},
		{name: "disabled", sql: `update app_user set status='disabled' where username='alice'`, want: ErrInvalidSession},
		{name: "deleted", sql: `update app_user set deleted_at=now() where username='alice'`, want: ErrInvalidSession},
		{name: "builtin", sql: `update app_user set builtin=true where username='alice'`, want: ErrInvalidSession},
		{name: "guest", sql: `update app_user set group_id='00000000-0000-0000-0000-000000000002' where username='alice'`, want: ErrInvalidSession},
		{name: "oidc-only", sql: `update app_user set password_hash=null where username='alice'`, want: ErrPasswordUnavailable},
		{name: "unsupported", sql: `update app_user set password_hash='unsupported' where username='alice'`, want: ErrPasswordUnavailable},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pool, service, _ := passwordFixture(t)
			if _, err := pool.Exec(t.Context(), tt.sql); err != nil {
				t.Fatal(err)
			}
			status, err := service.PasswordStatus(t.Context(), "current")
			if errors.Is(tt.want, ErrInvalidSession) {
				if !errors.Is(err, tt.want) {
					t.Fatalf("status=%v", err)
				}
			} else if err != nil || status.CanChangePassword {
				t.Fatalf("status=%+v,%v", status, err)
			}
			if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}); !errors.Is(err, tt.want) {
				t.Fatalf("change=%v", err)
			}
		})
	}
	if _, err := NewService(nil, time.Hour).PasswordStatus(t.Context(), ""); !errors.Is(err, ErrInvalidSession) {
		t.Fatalf("empty status=%v", err)
	}
}

// TestPasswordChangeSharesFailureWindowAndIgnoresLoginPolicy verifies existing sessions remain useful when local login is disabled.
func TestPasswordChangeSharesFailureWindowAndIgnoresLoginPolicy(t *testing.T) {
	pool, service, _ := passwordFixture(t)
	service.loginPolicy = internalLoginPolicyFunc(func(context.Context) (bool, error) {
		t.Fatal("password change consulted login policy")
		return false, nil
	})
	status, err := service.PasswordStatus(t.Context(), "current")
	if err != nil || !status.CanChangePassword {
		t.Fatalf("status=%+v %v", status, err)
	}
	for i := int16(1); i <= LoginFailureThreshold; i++ {
		want := ErrInvalidCredentials
		if i == LoginFailureThreshold {
			want = ErrLoginRateLimited
		}
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		if err := service.ChangePassword(ctx, "current", ChangePasswordInput{CurrentPassword: "wrong", NewPassword: "new-password"}); !errors.Is(err, want) {
			t.Fatalf("attempt %d=%v", i, err)
		}
	}
	service.loginPolicy = enabledLoginPolicy{}
	if _, err := service.Login(t.Context(), LoginInput{Username: "alice", Password: " old <&密码> "}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("shared block=%v", err)
	}
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("change block=%v", err)
	}
	if _, err := pool.Exec(t.Context(), `update auth_login_attempt set blocked_until=now()-interval '1 second',window_started_at=now()-interval '16 minutes'`); err != nil {
		t.Fatal(err)
	}
	if err := service.ChangePassword(t.Context(), "current", ChangePasswordInput{CurrentPassword: " old <&密码> ", NewPassword: "new-password"}); err != nil {
		t.Fatal(err)
	}
	var attempts int
	if err := pool.QueryRow(t.Context(), `select count(*) from auth_login_attempt`).Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if attempts != 0 {
		t.Fatalf("attempts not cleared: %d", attempts)
	}
}
