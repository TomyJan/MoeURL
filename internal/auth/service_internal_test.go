package auth

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestNewServiceWithNilPasswordVerifierUsesDefault verifies nil injection keeps the production verifier.
func TestNewServiceWithNilPasswordVerifierUsesDefault(t *testing.T) {
	service := NewServiceWithPasswordVerifier(nil, time.Hour, nil)
	if !isSupportedPasswordHash(loginDummyPasswordHash) {
		t.Fatal("dummy password hash does not use the supported account profile")
	}
	if !service.verifyPassword("moeurl-login-dummy-password", loginDummyPasswordHash) {
		t.Fatal("nil password verifier did not fall back to VerifyPassword")
	}
}

// TestLoginGlobalAdmissionRejectsBeforeDatabaseAndVerifier verifies saturation sheds work before opening a transaction.
func TestLoginGlobalAdmissionRejectsBeforeDatabaseAndVerifier(t *testing.T) {
	verifierCalled := false
	service := NewServiceWithPasswordVerifier(nil, time.Hour, func(string, string) bool {
		verifierCalled = true
		return false
	})
	if capacity := cap(service.loginSlots); capacity != defaultLoginConcurrency {
		t.Fatalf("login admission capacity = %d, want %d", capacity, defaultLoginConcurrency)
	}
	if capacity := cap(service.loginSlots); capacity <= 2 {
		t.Fatalf("login admission capacity = %d, want more than password-verification capacity 2", capacity)
	}
	for range cap(service.loginSlots) {
		service.loginSlots <- struct{}{}
	}

	if _, err := service.Login(t.Context(), LoginInput{Username: "alice", Password: "candidate"}); !errors.Is(err, ErrLoginRateLimited) {
		t.Fatalf("login error = %v, want ErrLoginRateLimited", err)
	}
	if verifierCalled {
		t.Fatal("saturated login reached the password verifier")
	}
}

// TestLoginPasswordVerificationAdmissionRejectsBeforeVerifier verifies Argon2 work has an independent capacity-two boundary.
func TestLoginPasswordVerificationAdmissionRejectsBeforeVerifier(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	pool := authInternalTestPool(t, ctx, 4)
	verifierEntered := make(chan struct{}, 3)
	releaseVerifier := make(chan struct{})
	var releaseOnce sync.Once
	t.Cleanup(func() { releaseOnce.Do(func() { close(releaseVerifier) }) })
	service := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool {
		verifierEntered <- struct{}{}
		<-releaseVerifier
		return false
	})
	results := make(chan error, 3)
	login := func(username string) {
		_, err := service.Login(ctx, LoginInput{Username: username, Password: "candidate"})
		results <- err
	}

	go login("first-unknown-user")
	go login("second-unknown-user")
	waitForInternalAuthSignal(t, ctx, verifierEntered, "first password verifier")
	waitForInternalAuthSignal(t, ctx, verifierEntered, "second password verifier")
	go login("third-unknown-user")

	select {
	case <-verifierEntered:
		t.Fatal("saturated password-verification admission reached the verifier")
	case err := <-results:
		if !errors.Is(err, ErrLoginRateLimited) {
			t.Fatalf("saturated password-verification login error = %v, want ErrLoginRateLimited", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for password-verification admission: %v", ctx.Err())
	}

	releaseOnce.Do(func() { close(releaseVerifier) })
	for range 2 {
		if err := waitForInternalAuthValue(t, ctx, results, "admitted login result"); !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("admitted login error = %v, want ErrInvalidCredentials", err)
		}
	}
	if _, err := service.Login(ctx, LoginInput{Username: "fourth-unknown-user", Password: "candidate"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("login after verifier release error = %v, want ErrInvalidCredentials", err)
	}
}

// TestLoginRandomFailureRollsBack verifies entropy failure cannot clear attempts or persist a Session.
func TestLoginRandomFailureRollsBack(t *testing.T) {
	ctx := context.Background()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	passwordHash, err := HashPassword("correct-password")
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now())
	`); err != nil {
		t.Fatalf("insert random-failure group: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000201', 'alice', $1, 'Alice', '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, passwordHash); err != nil {
		t.Fatalf("insert random-failure user: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into auth_login_attempt (
			username_hash, failed_attempts, window_started_at, blocked_until, updated_at
		) values ($1, 4, clock_timestamp(), null, clock_timestamp())
	`, hashLoginUsername("alice")); err != nil {
		t.Fatalf("insert random-failure login attempt: %v", err)
	}

	randomFailure := errors.New("random failed")
	service := NewService(pool, time.Hour)
	service.sessionIDGenerator = func() (string, error) {
		return "", randomFailure
	}

	if _, err := service.Login(ctx, LoginInput{Username: "alice", Password: "correct-password"}); !errors.Is(err, randomFailure) {
		t.Fatalf("login error = %v, want random failure", err)
	}
	var failedAttempts int16
	if err := pool.QueryRow(ctx, `
		select failed_attempts from auth_login_attempt where username_hash = $1
	`, hashLoginUsername("alice")).Scan(&failedAttempts); err != nil {
		t.Fatalf("read rolled-back login attempt: %v", err)
	}
	if failedAttempts != 4 {
		t.Fatalf("failed attempts = %d, want preserved value 4", failedAttempts)
	}
	var sessionCount int
	if err := pool.QueryRow(ctx, `select count(*) from session`).Scan(&sessionCount); err != nil {
		t.Fatalf("count sessions after random failure: %v", err)
	}
	if sessionCount != 0 {
		t.Fatalf("session count = %d, want 0", sessionCount)
	}
}

// TestLoginRequestCancellationStillCommitsFailure verifies a client disconnect cannot bypass the database-backed counter.
func TestLoginRequestCancellationStillCommitsFailure(t *testing.T) {
	pool := authInternalTestPool(t, t.Context(), 1)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	insertInternalLoginFixtures(t, ctx, pool, false)

	backendPID := authInternalTestBackendPID(t, ctx, pool)
	requestContext, cancelRequest := context.WithCancel(ctx)
	verifierCalls := 0
	service := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool {
		verifierCalls++
		cancelRequest()
		return false
	})

	if _, err := service.Login(requestContext, LoginInput{Username: "alice", Password: "wrong-password"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("login error = %v, want ErrInvalidCredentials", err)
	}
	if verifierCalls != 1 {
		t.Fatalf("password verifier calls = %d, want 1", verifierCalls)
	}
	var failedAttempts int16
	if err := pool.QueryRow(ctx, `
		select failed_attempts from auth_login_attempt where username_hash = $1
	`, hashLoginUsername("alice")).Scan(&failedAttempts); err != nil {
		t.Fatalf("read committed login attempt: %v", err)
	}
	if failedAttempts != 1 {
		t.Fatalf("failed attempts = %d, want 1", failedAttempts)
	}
	if reusablePID := authInternalTestBackendPID(t, ctx, pool); reusablePID != backendPID {
		t.Fatalf("reusable backend pid = %d, want original %d", reusablePID, backendPID)
	}
}

// TestLoginRequestCancellationRollsBackInfrastructureFailures verifies detached work does not commit partial success state.
func TestLoginRequestCancellationRollsBackInfrastructureFailures(t *testing.T) {
	tests := []struct {
		name             string
		breakPermissions bool
		failRandom       bool
		initialAttempts  int16
	}{
		{name: "permission decode", breakPermissions: true},
		{name: "session randomness", failRandom: true, initialAttempts: 4},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pool := authInternalTestPool(t, t.Context(), 1)
			ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
			defer cancel()
			insertInternalLoginFixtures(t, ctx, pool, test.breakPermissions)
			if test.initialAttempts > 0 {
				if _, err := pool.Exec(ctx, `
					insert into auth_login_attempt (
						username_hash, failed_attempts, window_started_at, blocked_until, updated_at
					) values ($1, $2, clock_timestamp(), null, clock_timestamp())
				`, hashLoginUsername("alice"), test.initialAttempts); err != nil {
					t.Fatalf("insert initial login attempt: %v", err)
				}
			}

			backendPID := authInternalTestBackendPID(t, ctx, pool)
			requestContext, cancelRequest := context.WithCancel(ctx)
			service := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool {
				cancelRequest()
				return true
			})
			randomFailure := errors.New("random failed")
			if test.failRandom {
				service.sessionIDGenerator = func() (string, error) { return "", randomFailure }
			}

			_, err := service.Login(requestContext, LoginInput{Username: "alice", Password: "correct-password"})
			if err == nil {
				t.Fatal("expected infrastructure failure")
			}
			if test.failRandom && !errors.Is(err, randomFailure) {
				t.Fatalf("login error = %v, want random failure", err)
			}
			var failedAttempts int16
			readErr := pool.QueryRow(ctx, `
				select failed_attempts from auth_login_attempt where username_hash = $1
			`, hashLoginUsername("alice")).Scan(&failedAttempts)
			if test.initialAttempts == 0 {
				if !errors.Is(readErr, pgx.ErrNoRows) {
					t.Fatalf("rolled-back inserted attempt error = %v, want pgx.ErrNoRows", readErr)
				}
			} else {
				if readErr != nil {
					t.Fatalf("read preserved login attempt: %v", readErr)
				}
				if failedAttempts != test.initialAttempts {
					t.Fatalf("failed attempts = %d, want preserved %d", failedAttempts, test.initialAttempts)
				}
			}
			if reusablePID := authInternalTestBackendPID(t, ctx, pool); reusablePID != backendPID {
				t.Fatalf("reusable backend pid = %d, want original %d", reusablePID, backendPID)
			}
		})
	}
}

// TestLoginOperationTimeoutRollsBackWithReusableConnection verifies an expired operation Context cannot poison cleanup.
func TestLoginOperationTimeoutRollsBackWithReusableConnection(t *testing.T) {
	pool := authInternalTestPool(t, t.Context(), 1)
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	insertInternalLoginFixtures(t, ctx, pool, false)
	if _, err := pool.Exec(ctx, `
		insert into auth_login_attempt (
			username_hash, failed_attempts, window_started_at, blocked_until, updated_at
		) values ($1, 3, clock_timestamp(), null, clock_timestamp())
	`, hashLoginUsername("alice")); err != nil {
		t.Fatalf("insert timeout login attempt: %v", err)
	}

	backendPID := authInternalTestBackendPID(t, ctx, pool)
	service := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool {
		verifierContext, cancelVerifier := context.WithTimeout(context.WithoutCancel(ctx), 100*time.Millisecond)
		defer cancelVerifier()
		<-verifierContext.Done()
		return false
	})
	service.loginOperationTimeout = 10 * time.Millisecond
	service.loginRollbackTimeout = time.Second
	if _, err := service.Login(ctx, LoginInput{Username: "alice", Password: "wrong-password"}); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("login error = %v, want context deadline exceeded", err)
	}

	reuseContext, cancelReuse := context.WithTimeout(ctx, time.Second)
	defer cancelReuse()
	if reusablePID := authInternalTestBackendPID(t, reuseContext, pool); reusablePID != backendPID {
		t.Fatalf("reusable backend pid = %d, want original %d", reusablePID, backendPID)
	}
	var failedAttempts int16
	if err := pool.QueryRow(reuseContext, `
		select failed_attempts from auth_login_attempt where username_hash = $1
	`, hashLoginUsername("alice")).Scan(&failedAttempts); err != nil {
		t.Fatalf("read rolled-back timeout attempt: %v", err)
	}
	if failedAttempts != 3 {
		t.Fatalf("failed attempts = %d, want preserved 3", failedAttempts)
	}
}

// TestCleanupStaleLoginAttemptsUsesOneFixedBatch verifies one maintenance cycle never drains unbounded work.
func TestCleanupStaleLoginAttemptsUsesOneFixedBatch(t *testing.T) {
	ctx := t.Context()
	calls := 0
	service := &Service{
		deleteStaleLoginAttempts: func(_ context.Context, batchSize int64) (int64, error) {
			calls++
			if batchSize != loginAttemptCleanupBatchSize {
				t.Fatalf("cleanup batch size = %d, want %d", batchSize, loginAttemptCleanupBatchSize)
			}
			return batchSize, nil
		},
	}

	if err := service.CleanupStaleLoginAttempts(ctx); err != nil {
		t.Fatalf("cleanup stale login attempts: %v", err)
	}
	if calls != 1 {
		t.Fatalf("cleanup calls = %d, want 1", calls)
	}
}

// TestCleanupStaleLoginAttemptsRejectsUnavailableDatabase verifies missing production cleanup dependencies fail safely.
func TestCleanupStaleLoginAttemptsRejectsUnavailableDatabase(t *testing.T) {
	if err := (&Service{}).CleanupStaleLoginAttempts(t.Context()); err == nil || !strings.Contains(err.Error(), "database is unavailable") {
		t.Fatalf("cleanup error = %v, want unavailable database", err)
	}
}

// TestRunLoginAttemptCleanupDefendsInvalidRuntimeParameters verifies invalid optional inputs cannot panic or start work.
func TestRunLoginAttemptCleanupDefendsInvalidRuntimeParameters(t *testing.T) {
	invalidIntervalCalls := 0
	service := &Service{
		deleteStaleLoginAttempts: func(context.Context, int64) (int64, error) {
			invalidIntervalCalls++
			return 0, nil
		},
	}
	service.RunLoginAttemptCleanup(t.Context(), 0, nil)
	if invalidIntervalCalls != 0 {
		t.Fatalf("invalid-interval cleanup calls = %d, want 0", invalidIntervalCalls)
	}

	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupCalled := make(chan struct{}, 1)
	service.deleteStaleLoginAttempts = func(context.Context, int64) (int64, error) {
		cleanupCalled <- struct{}{}
		return 0, nil
	}
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunLoginAttemptCleanup(runnerContext, time.Hour, nil)
	}()
	waitForInternalAuthSignal(t, ctx, cleanupCalled, "cleanup with default logger")
	cancelRunner()
	waitForInternalAuthSignal(t, ctx, runnerDone, "default-logger cleanup cancellation")
}

// TestRunLoginAttemptCleanupSkipsPreCanceledContext verifies shutdown cannot start an immediate database cleanup.
func TestRunLoginAttemptCleanupSkipsPreCanceledContext(t *testing.T) {
	runnerContext, cancelRunner := context.WithCancel(t.Context())
	cancelRunner()
	cleanupCalls := 0
	service := &Service{
		deleteStaleLoginAttempts: func(context.Context, int64) (int64, error) {
			cleanupCalls++
			return 0, nil
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))

	service.RunLoginAttemptCleanup(runnerContext, time.Hour, logger)

	if cleanupCalls != 0 {
		t.Fatalf("pre-canceled cleanup calls = %d, want 0", cleanupCalls)
	}
	if logOutput.Len() != 0 {
		t.Fatalf("pre-canceled cleanup log = %q, want empty", logOutput.String())
	}
}

// TestRunLoginAttemptCleanupTreatsTaskCancellationAsShutdown verifies in-flight cancellation exits without an error log.
func TestRunLoginAttemptCleanupTreatsTaskCancellationAsShutdown(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupStarted := make(chan struct{})
	service := &Service{
		deleteStaleLoginAttempts: func(cleanupContext context.Context, _ int64) (int64, error) {
			close(cleanupStarted)
			<-cleanupContext.Done()
			return 0, cleanupContext.Err()
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunLoginAttemptCleanup(runnerContext, time.Hour, logger)
	}()

	waitForInternalAuthSignal(t, ctx, cleanupStarted, "in-flight login-attempt cleanup")
	cancelRunner()
	waitForInternalAuthSignal(t, ctx, runnerDone, "canceled login-attempt cleanup runner")
	if strings.Contains(logOutput.String(), "login_attempt_cleanup_failed") {
		t.Fatalf("task cancellation logged as cleanup failure: %q", logOutput.String())
	}
}

// TestRunLoginAttemptCleanupExitsQuietlyWhenPeriodicCleanupIsCanceled verifies ticker work treats shutdown as lifecycle completion.
func TestRunLoginAttemptCleanupExitsQuietlyWhenPeriodicCleanupIsCanceled(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	runnerContext, cancelRunner := context.WithCancel(ctx)
	cleanupCalls := make(chan int, 2)
	calls := 0
	service := &Service{
		deleteStaleLoginAttempts: func(cleanupContext context.Context, _ int64) (int64, error) {
			calls++
			cleanupCalls <- calls
			if calls == 1 {
				return 1, nil
			}
			<-cleanupContext.Done()
			return 0, cleanupContext.Err()
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunLoginAttemptCleanup(runnerContext, time.Millisecond, logger)
	}()

	if call := waitForInternalAuthValue(t, ctx, cleanupCalls, "immediate login-attempt cleanup"); call != 1 {
		t.Fatalf("immediate cleanup call = %d, want 1", call)
	}
	if call := waitForInternalAuthValue(t, ctx, cleanupCalls, "periodic login-attempt cleanup"); call != 2 {
		t.Fatalf("periodic cleanup call = %d, want 2", call)
	}
	cancelRunner()
	waitForInternalAuthSignal(t, ctx, runnerDone, "periodically canceled login-attempt cleanup runner")
	if strings.Contains(logOutput.String(), "login_attempt_cleanup_failed") {
		t.Fatalf("periodic task cancellation logged as cleanup failure: %q", logOutput.String())
	}
}

// TestRunLoginAttemptCleanupRunsImmediatelyAndPeriodically verifies startup work and ticker scheduling.
func TestRunLoginAttemptCleanupRunsImmediatelyAndPeriodically(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	cleanupCalls := make(chan struct{}, 3)
	service := &Service{
		deleteStaleLoginAttempts: func(cleanupContext context.Context, _ int64) (int64, error) {
			select {
			case cleanupCalls <- struct{}{}:
				return 0, nil
			case <-cleanupContext.Done():
				return 0, cleanupContext.Err()
			}
		},
	}
	runnerContext, cancelRunner := context.WithCancel(ctx)
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunLoginAttemptCleanup(runnerContext, time.Millisecond, slog.Default())
	}()

	waitForInternalAuthSignal(t, ctx, cleanupCalls, "immediate login-attempt cleanup")
	waitForInternalAuthSignal(t, ctx, cleanupCalls, "periodic login-attempt cleanup")
	cancelRunner()
	waitForInternalAuthSignal(t, ctx, runnerDone, "login-attempt cleanup cancellation")
}

// TestRunLoginAttemptCleanupLogsFailureAndContinues verifies one failed cycle cannot stop future maintenance.
func TestRunLoginAttemptCleanupLogsFailureAndContinues(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	cleanupFailure := errors.New("forced cleanup failure")
	cleanupCalls := make(chan int, 3)
	calls := 0
	service := &Service{
		deleteStaleLoginAttempts: func(cleanupContext context.Context, _ int64) (int64, error) {
			calls++
			select {
			case cleanupCalls <- calls:
			case <-cleanupContext.Done():
				return 0, cleanupContext.Err()
			}
			if calls == 1 {
				return 0, cleanupFailure
			}
			return 1, nil
		},
	}
	logOutput := &bytes.Buffer{}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))
	runnerContext, cancelRunner := context.WithCancel(ctx)
	runnerDone := make(chan struct{})
	go func() {
		defer close(runnerDone)
		service.RunLoginAttemptCleanup(runnerContext, time.Millisecond, logger)
	}()

	if call := waitForInternalAuthValue(t, ctx, cleanupCalls, "failed cleanup cycle"); call != 1 {
		t.Fatalf("first cleanup call = %d, want 1", call)
	}
	if call := waitForInternalAuthValue(t, ctx, cleanupCalls, "successful cleanup cycle"); call != 2 {
		t.Fatalf("second cleanup call = %d, want 2", call)
	}
	cancelRunner()
	waitForInternalAuthSignal(t, ctx, runnerDone, "cleanup runner after recovered cycle")

	logText := logOutput.String()
	if !strings.Contains(logText, "login_attempt_cleanup_failed") || !strings.Contains(logText, cleanupFailure.Error()) {
		t.Fatalf("cleanup failure log = %q, want safe task name and error", logText)
	}
	if strings.Contains(logText, hashLoginUsername("alice")) {
		t.Fatalf("cleanup failure log leaked username hash: %q", logText)
	}
}

// TestLockOrCreateLoginAttemptRetriesAfterConcurrentDelete verifies a missing row can be created, conflicted, and deleted before the waiter locks it.
func TestLockOrCreateLoginAttemptRetriesAfterConcurrentDelete(t *testing.T) {
	databaseURL := testdb.ProjectMigratedDatabaseURL(t.Context(), t)
	pool, err := appdb.OpenPool(t.Context(), databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()

	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '[]'::jsonb, true, now(), now());
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (
			'00000000-0000-0000-0000-000000000301',
			'alice',
			'$argon2id$v=19$m=65536,t=1,p=4$Br1VkWYfZh4At1JIZgluRg$oo5ZbILTTrshpMQUQxgjSWh7sJJWbxt8i+KrE+Vu2sI',
			'Alice',
			'00000000-0000-0000-0000-000000000001',
			'active',
			false,
			now(),
			now()
		)
	`); err != nil {
		t.Fatalf("insert concurrent-delete fixtures: %v", err)
	}

	waiterTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin waiter transaction: %v", err)
	}
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cleanupCancel()
		_ = waiterTx.Rollback(cleanupContext)
	}()
	var waiterPID int32
	if err := waiterTx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&waiterPID); err != nil {
		t.Fatalf("read waiter backend pid: %v", err)
	}
	if _, err := pool.Exec(ctx, `create table auth_login_attempt_test_gate (target_pid integer not null)`); err != nil {
		t.Fatalf("create login-attempt test gate: %v", err)
	}
	if _, err := pool.Exec(ctx, `insert into auth_login_attempt_test_gate (target_pid) values ($1)`, waiterPID); err != nil {
		t.Fatalf("configure login-attempt test gate: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		create function gate_target_login_attempt_insert() returns trigger
		language plpgsql as $$
		begin
			if pg_backend_pid() = (select target_pid from auth_login_attempt_test_gate limit 1) then
				perform pg_advisory_xact_lock(6060004);
			end if;
			return new;
		end
		$$;
		create trigger gate_target_login_attempt_insert
		before insert on auth_login_attempt
		for each row execute function gate_target_login_attempt_insert()
	`); err != nil {
		t.Fatalf("install login-attempt test gate: %v", err)
	}

	gateConnection, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire advisory-lock connection: %v", err)
	}
	defer gateConnection.Release()
	if _, err := gateConnection.Exec(ctx, `select pg_advisory_lock(6060004)`); err != nil {
		t.Fatalf("acquire login-attempt test gate: %v", err)
	}
	gateReleased := false
	defer func() {
		if !gateReleased {
			cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cleanupCancel()
			_, _ = gateConnection.Exec(cleanupContext, `select pg_advisory_unlock(6060004)`)
		}
	}()

	type lockResult struct {
		attempt sqlc.GetAuthLoginAttemptForUpdateRow
		err     error
	}
	waiterResult := make(chan lockResult, 1)
	go func() {
		attempt, err := lockOrCreateLoginAttempt(ctx, sqlc.New(waiterTx), hashLoginUsername("alice"))
		waiterResult <- lockResult{attempt: attempt, err: err}
	}()
	waitForBackendLock(t, ctx, pool, waiterPID, "advisory")

	failureService := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool { return false })
	if _, err := failureService.Login(ctx, LoginInput{Username: "alice", Password: "wrong-password"}); !errors.Is(err, ErrInvalidCredentials) {
		t.Fatalf("fixture failure login error = %v, want ErrInvalidCredentials", err)
	}

	successVerifying := make(chan struct{})
	releaseSuccess := make(chan struct{})
	successReleased := false
	defer func() {
		if !successReleased {
			close(releaseSuccess)
		}
	}()
	successService := NewServiceWithPasswordVerifier(pool, time.Hour, func(string, string) bool {
		close(successVerifying)
		<-releaseSuccess
		return true
	})
	successResult := make(chan error, 1)
	go func() {
		_, err := successService.Login(ctx, LoginInput{Username: "alice", Password: "correct-password"})
		successResult <- err
	}()
	select {
	case <-successVerifying:
	case <-ctx.Done():
		t.Fatalf("successful login did not lock the attempt row: %v", ctx.Err())
	}

	if _, err := gateConnection.Exec(ctx, `select pg_advisory_unlock(6060004)`); err != nil {
		t.Fatalf("release login-attempt test gate: %v", err)
	}
	gateReleased = true
	waitForBackendLock(t, ctx, pool, waiterPID, "non-advisory")
	close(releaseSuccess)
	successReleased = true
	select {
	case err := <-successResult:
		if err != nil {
			t.Fatalf("successful deleting login: %v", err)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for deleting login: %v", ctx.Err())
	}

	select {
	case result := <-waiterResult:
		if result.err != nil {
			t.Fatalf("lock or create after concurrent delete: %v", result.err)
		}
		if result.attempt.UsernameHash != hashLoginUsername("alice") {
			t.Fatalf("locked username hash = %q, want alice digest", result.attempt.UsernameHash)
		}
	case <-ctx.Done():
		t.Fatalf("timed out waiting for lock-or-create retry: %v", ctx.Err())
	}
}

// waitForBackendLock waits for one backend to block on the requested PostgreSQL lock class.
func waitForBackendLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool, pid int32, lockClass string) {
	t.Helper()
	for {
		var waiting int
		if err := pool.QueryRow(ctx, `
			select count(*)
			from pg_locks
			where pid = $1
				and not granted
				and case when $2 = 'advisory' then locktype = 'advisory' else locktype <> 'advisory' end
		`, pid, lockClass).Scan(&waiting); err != nil {
			t.Fatalf("inspect backend lock: %v", err)
		}
		if waiting > 0 {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("backend %d did not wait on %s lock: %v", pid, lockClass, ctx.Err())
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// authInternalTestPool opens a single isolated migrated database with an explicit Pool limit.
func authInternalTestPool(t *testing.T, ctx context.Context, maxConnections int32) *pgxpool.Pool {
	t.Helper()
	return authInternalTestPoolFromURL(t, ctx, testdb.ProjectMigratedDatabaseURL(ctx, t), maxConnections)
}

// authInternalTestPoolFromURL opens one Pool against a known test database URL.
func authInternalTestPoolFromURL(t *testing.T, ctx context.Context, databaseURL string, maxConnections int32) *pgxpool.Pool {
	t.Helper()
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse pool config: %v", err)
	}
	config.MaxConns = maxConnections
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("open bounded pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping bounded pool: %v", err)
	}
	return pool
}

// insertInternalLoginFixtures creates one active account used by detached-context tests.
func insertInternalLoginFixtures(t *testing.T, ctx context.Context, pool *pgxpool.Pool, breakPermissions bool) {
	t.Helper()
	permissions := "[]"
	if breakPermissions {
		permissions = "123"
	}
	passwordHash, err := HashPassword("correct-password")
	if err != nil {
		t.Fatalf("hash login password: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', $1::jsonb, true, now(), now())
	`, permissions); err != nil {
		t.Fatalf("insert detached-context login group: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (
			'00000000-0000-0000-0000-000000000401',
			'alice',
			$1,
			'Alice',
			'00000000-0000-0000-0000-000000000001',
			'active',
			false,
			now(),
			now()
		)
	`, passwordHash); err != nil {
		t.Fatalf("insert detached-context login user: %v", err)
	}
}

// authInternalTestBackendPID returns the PostgreSQL process used by the only available Pool connection.
func authInternalTestBackendPID(t *testing.T, ctx context.Context, pool *pgxpool.Pool) int32 {
	t.Helper()
	var backendPID int32
	if err := pool.QueryRow(ctx, `select pg_backend_pid()`).Scan(&backendPID); err != nil {
		t.Fatalf("read backend pid: %v", err)
	}
	return backendPID
}

// waitForInternalAuthSignal waits for a deterministic auth test event under the test Context.
func waitForInternalAuthSignal(t *testing.T, ctx context.Context, signal <-chan struct{}, operation string) {
	t.Helper()
	select {
	case <-signal:
	case <-ctx.Done():
		t.Fatalf("timed out waiting for %s: %v", operation, ctx.Err())
	}
}

// waitForInternalAuthValue waits for a deterministic auth test result under the test Context.
func waitForInternalAuthValue[T any](t *testing.T, ctx context.Context, values <-chan T, operation string) T {
	t.Helper()
	select {
	case value := <-values:
		return value
	case <-ctx.Done():
		t.Fatalf("timed out waiting for %s: %v", operation, ctx.Err())
		var zero T
		return zero
	}
}
