package auth_test

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestAuthServiceLoginUsesConstantPasswordVerificationPaths verifies indistinguishable credential failures verify exactly once.
func TestAuthServiceLoginUsesConstantPasswordVerificationPaths(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	insertLoginUserWithoutPassword(t, ctx, pool, "system")
	insertLoginUserWithPasswordHash(t, ctx, pool, "empty-hash", "")
	insertLoginUserWithPasswordHash(t, ctx, pool, "malformed-hash", "not-an-argon2id-hash")
	insertLoginUserWithPasswordHash(t, ctx, pool, "invalid-salt", "$argon2id$v=19$m=65536,t=1,p=4$not-base64!$oo5ZbILTTrshpMQUQxgjSWh7sJJWbxt8i+KrE+Vu2sI")
	insertLoginUserWithPasswordHash(t, ctx, pool, "invalid-key", "$argon2id$v=19$m=65536,t=1,p=4$Br1VkWYfZh4At1JIZgluRg$not-base64!")

	tests := []struct {
		name        string
		username    string
		password    string
		expectDummy bool
	}{
		{name: "unknown username", username: "missing", password: "candidate", expectDummy: true},
		{name: "nil password hash", username: "system", password: "candidate", expectDummy: true},
		{name: "empty password hash", username: "empty-hash", password: "candidate", expectDummy: true},
		{name: "malformed password hash", username: "malformed-hash", password: "candidate", expectDummy: true},
		{name: "invalid password salt", username: "invalid-salt", password: "candidate", expectDummy: true},
		{name: "invalid password key", username: "invalid-key", password: "candidate", expectDummy: true},
		{name: "wrong password", username: "alice", password: "wrong-password"},
	}
	var dummyHashes []string
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			verifiedHash := ""
			service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(_ string, encodedHash string) bool {
				calls++
				verifiedHash = encodedHash
				return false
			})

			_, err := service.Login(ctx, auth.LoginInput{Username: test.username, Password: test.password})
			if !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("login error = %v, want ErrInvalidCredentials", err)
			}
			if calls != 1 {
				t.Fatalf("password verifier calls = %d, want 1", calls)
			}
			if test.expectDummy {
				dummyHashes = append(dummyHashes, verifiedHash)
			}
		})
	}
	if len(dummyHashes) != 6 {
		t.Fatalf("dummy hash count = %d, want 6", len(dummyHashes))
	}
	for _, candidate := range dummyHashes[1:] {
		if candidate != dummyHashes[0] {
			t.Fatalf("dummy hashes = %#v, want one fixed value", dummyHashes)
		}
	}
	if dummyHashes[0] == "" {
		t.Fatalf("dummy hashes = %#v, want one fixed value", dummyHashes)
	}
	if !strings.HasPrefix(dummyHashes[0], "$argon2id$v=19$m=65536,t=1,p=4$") {
		t.Fatalf("dummy hash does not match current Argon2id parameters: %q", dummyHashes[0])
	}
	if !auth.VerifyPassword("moeurl-login-dummy-password", dummyHashes[0]) {
		t.Fatal("dummy hash is not valid for its fixed password")
	}
}

// TestAuthServiceLoginUnsupportedPasswordHashUsesDummy verifies validly encoded but unsupported account hashes use the fixed dummy path.
func TestAuthServiceLoginUnsupportedPasswordHashUsesDummy(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)

	tests := []struct {
		name       string
		username   string
		storedHash string
	}{
		{
			name:       "unsupported version",
			username:   "version-user",
			storedHash: "$argon2id$v=18$m=65536,t=1,p=4$Br1VkWYfZh4At1JIZgluRg$oo5ZbILTTrshpMQUQxgjSWh7sJJWbxt8i+KrE+Vu2sI",
		},
		{
			name:       "unsupported parameters",
			username:   "parameter-user",
			storedHash: "$argon2id$v=19$m=32768,t=2,p=2$Br1VkWYfZh4At1JIZgluRg$oo5ZbILTTrshpMQUQxgjSWh7sJJWbxt8i+KrE+Vu2sI",
		},
	}
	for _, test := range tests {
		insertLoginUserWithPasswordHash(t, ctx, pool, test.username, test.storedHash)
	}

	dummyHash := ""
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			verifierCalls := 0
			verifiedHash := ""
			service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(_ string, encodedHash string) bool {
				verifierCalls++
				verifiedHash = encodedHash
				return false
			})

			_, err := service.Login(ctx, auth.LoginInput{Username: test.username, Password: "candidate"})
			if !errors.Is(err, auth.ErrInvalidCredentials) {
				t.Fatalf("login error = %v, want ErrInvalidCredentials", err)
			}
			if verifierCalls != 1 {
				t.Fatalf("password verifier calls = %d, want 1", verifierCalls)
			}
			if verifiedHash == test.storedHash {
				t.Fatal("password verifier received the unsupported stored hash")
			}
			if !auth.VerifyPassword("moeurl-login-dummy-password", verifiedHash) {
				t.Fatalf("password verifier hash is not the fixed valid dummy: %q", verifiedHash)
			}
			if dummyHash == "" {
				dummyHash = verifiedHash
			} else if verifiedHash != dummyHash {
				t.Fatalf("dummy hash = %q, want fixed value %q", verifiedHash, dummyHash)
			}
			assertLoginAttemptCount(t, ctx, pool, test.username, 1)
		})
	}
}

// TestAuthServiceLoginVerifiesPasswordBeforeDecodingPermissions verifies corrupt account metadata cannot skip the password work factor.
func TestAuthServiceLoginVerifiesPasswordBeforeDecodingPermissions(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	if _, err := pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`); err != nil {
		t.Fatalf("break permissions shape: %v", err)
	}

	verifierCalls := 0
	service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool {
		verifierCalls++
		return true
	})
	if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"}); err == nil {
		t.Fatal("expected permissions decode error")
	}
	if verifierCalls != 1 {
		t.Fatalf("password verifier calls = %d, want 1", verifierCalls)
	}
}

// TestAuthServiceLoginNormalizesUsernameWithoutFoldingCase verifies lookup and hashing share trim-only normalization.
func TestAuthServiceLoginNormalizesUsernameWithoutFoldingCase(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "CaseUser", "correct-password", "active")

	service := auth.NewService(pool, 24*time.Hour)
	result, err := service.Login(ctx, auth.LoginInput{Username: "  CaseUser\t", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login with trimmed username: %v", err)
	}
	if result.User.Username != "CaseUser" {
		t.Fatalf("normalized login username = %q, want CaseUser", result.User.Username)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "caseuser", Password: "correct-password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("case-folded login error = %v, want ErrInvalidCredentials", err)
	}
	var storedHash string
	if err := pool.QueryRow(ctx, `select username_hash from auth_login_attempt`).Scan(&storedHash); err != nil {
		t.Fatalf("read normalized username hash: %v", err)
	}
	if want := testLoginUsernameHash("caseuser"); storedHash != want {
		t.Fatalf("username hash = %q, want %q", storedHash, want)
	}
	if strings.Contains(storedHash, "caseuser") {
		t.Fatalf("username hash leaked plaintext: %q", storedHash)
	}
}

// TestAuthServiceLoginRateLimitUsesDatabaseState verifies the tenth failure and blocked period semantics.
func TestAuthServiceLoginRateLimitUsesDatabaseState(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")

	var verifierCalls atomic.Int32
	service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool {
		verifierCalls.Add(1)
		return false
	})
	for attempt := int16(1); attempt < auth.LoginFailureThreshold; attempt++ {
		_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
		if !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("failure %d error = %v, want ErrInvalidCredentials", attempt, err)
		}
	}
	_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrLoginRateLimited) {
		t.Fatalf("tenth failure error = %v, want ErrLoginRateLimited", err)
	}
	_, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrLoginRateLimited) {
		t.Fatalf("blocked login error = %v, want ErrLoginRateLimited", err)
	}
	if got := verifierCalls.Load(); got != int32(auth.LoginFailureThreshold) {
		t.Fatalf("password verifier calls = %d, want %d before direct blocking", got, auth.LoginFailureThreshold)
	}

	var failedAttempts int16
	var blockedUntil time.Time
	var updatedAt time.Time
	if err := pool.QueryRow(ctx, `
		select failed_attempts, blocked_until, updated_at
		from auth_login_attempt
		where username_hash = $1
	`, testLoginUsernameHash("alice")).Scan(&failedAttempts, &blockedUntil, &updatedAt); err != nil {
		t.Fatalf("read blocked login attempt: %v", err)
	}
	if blockedFor := blockedUntil.Sub(updatedAt); failedAttempts != auth.LoginFailureThreshold || blockedFor != 15*time.Minute {
		t.Fatalf("blocked state = attempts %d duration %s, want %d and 15m", failedAttempts, blockedFor, auth.LoginFailureThreshold)
	}
}

// TestAuthServiceLoginResetsExpiredFailureWindow verifies a database-prepared boundary restarts at one.
func TestAuthServiceLoginResetsExpiredFailureWindow(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	if _, err := pool.Exec(ctx, `
		insert into auth_login_attempt (
			username_hash, failed_attempts, window_started_at, blocked_until, updated_at
		) values ($1, 9, clock_timestamp() - interval '15 minutes', null, clock_timestamp())
	`, testLoginUsernameHash("alice")); err != nil {
		t.Fatalf("insert expired login window: %v", err)
	}

	service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool { return false })
	_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expired-window login error = %v, want ErrInvalidCredentials", err)
	}
	var attempts int16
	var blocked bool
	if err := pool.QueryRow(ctx, `
		select failed_attempts, blocked_until is not null
		from auth_login_attempt where username_hash = $1
	`, testLoginUsernameHash("alice")).Scan(&attempts, &blocked); err != nil {
		t.Fatalf("read reset login window: %v", err)
	}
	if attempts != 1 || blocked {
		t.Fatalf("reset state = attempts %d blocked %t, want 1 false", attempts, blocked)
	}
}

// TestAuthServiceLoginSuccessClearsAttemptsAndCreatesSession verifies success commits both changes atomically.
func TestAuthServiceLoginSuccessClearsAttemptsAndCreatesSession(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	if _, err := pool.Exec(ctx, `
		insert into auth_login_attempt (
			username_hash, failed_attempts, window_started_at, blocked_until, updated_at
		) values ($1, 9, clock_timestamp(), null, clock_timestamp())
	`, testLoginUsernameHash("alice")); err != nil {
		t.Fatalf("insert login-attempt fixture: %v", err)
	}

	service := auth.NewService(pool, 24*time.Hour)
	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("successful login: %v", err)
	}
	var attemptCount, sessionCount int
	if err := pool.QueryRow(ctx, `select count(*) from auth_login_attempt where username_hash = $1`, testLoginUsernameHash("alice")).Scan(&attemptCount); err != nil {
		t.Fatalf("count cleared login attempts: %v", err)
	}
	if err := pool.QueryRow(ctx, `select count(*) from session where id = $1 and user_id = $2`, result.Session.ID, result.User.ID).Scan(&sessionCount); err != nil {
		t.Fatalf("count committed login session: %v", err)
	}
	if attemptCount != 0 || sessionCount != 1 {
		t.Fatalf("successful login state = attempts %d sessions %d, want 0 and 1", attemptCount, sessionCount)
	}
}

// TestAuthServiceLoginDisabledUserDoesNotCreateSession verifies password failures hide disabled status and correct credentials stay sessionless.
func TestAuthServiceLoginDisabledUserDoesNotCreateSession(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "disabled", "correct-password", "disabled")
	service := auth.NewService(pool, 24*time.Hour)

	_, err := service.Login(ctx, auth.LoginInput{Username: "disabled", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("disabled wrong-password error = %v, want ErrInvalidCredentials", err)
	}
	_, err = service.Login(ctx, auth.LoginInput{Username: "disabled", Password: "correct-password"})
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("disabled correct-password error = %v, want ErrUserDisabled", err)
	}
	var sessionCount int
	if err := pool.QueryRow(ctx, `
		select count(*) from session
		join app_user on app_user.id = session.user_id
		where app_user.username = 'disabled'
	`).Scan(&sessionCount); err != nil {
		t.Fatalf("count disabled-user sessions: %v", err)
	}
	if sessionCount != 0 {
		t.Fatalf("disabled-user session count = %d, want 0", sessionCount)
	}
}

// TestAuthServiceLoginInfrastructureFailuresRollBack verifies decode and session-write errors preserve prior state.
func TestAuthServiceLoginInfrastructureFailuresRollBack(t *testing.T) {
	t.Run("permission decode", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`); err != nil {
			t.Fatalf("break permissions shape: %v", err)
		}
		service := auth.NewService(pool, 24*time.Hour)

		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"}); err == nil {
			t.Fatal("expected permissions decode error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 0)
	})

	t.Run("session insert", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `
			insert into auth_login_attempt (
				username_hash, failed_attempts, window_started_at, blocked_until, updated_at
			) values ($1, 3, clock_timestamp(), null, clock_timestamp())
		`, testLoginUsernameHash("alice")); err != nil {
			t.Fatalf("insert session-failure attempt: %v", err)
		}
		if _, err := pool.Exec(ctx, `drop table session`); err != nil {
			t.Fatalf("drop session table: %v", err)
		}
		service := auth.NewService(pool, 24*time.Hour)

		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"}); err == nil {
			t.Fatal("expected session insert error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 3)
	})
}

// TestAuthServiceLoginStatementFailuresRollBack verifies each transactional database failure is returned without partial state.
func TestAuthServiceLoginStatementFailuresRollBack(t *testing.T) {
	t.Run("initial lock", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		if _, err := pool.Exec(ctx, `drop table auth_login_attempt`); err != nil {
			t.Fatalf("drop login-attempt table: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "password"}); err == nil {
			t.Fatal("expected initial-lock error")
		}
	})

	t.Run("ensure attempt", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		if _, err := pool.Exec(ctx, `
			create function reject_login_attempt_insert() returns trigger
			language plpgsql as $$
			begin
				raise exception 'forced login-attempt insert failure';
			end
			$$;
			create trigger reject_login_attempt_insert
			before insert on auth_login_attempt
			for each row execute function reject_login_attempt_insert()
		`); err != nil {
			t.Fatalf("install insert failure: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "password"}); err == nil {
			t.Fatal("expected ensure-attempt error")
		}
	})

	t.Run("inserted attempt removed once", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		if _, err := pool.Exec(ctx, `
			create table remove_inserted_login_attempt_gate (remaining integer not null);
			insert into remove_inserted_login_attempt_gate (remaining) values (1);
			create function remove_inserted_login_attempt() returns trigger
			language plpgsql as $$
			begin
				if (select remaining > 0 from remove_inserted_login_attempt_gate) then
					update remove_inserted_login_attempt_gate set remaining = remaining - 1;
					delete from auth_login_attempt where username_hash = new.username_hash;
				end if;
				return new;
			end
			$$;
			create trigger remove_inserted_login_attempt
			after insert on auth_login_attempt
			for each row execute function remove_inserted_login_attempt()
		`); err != nil {
			t.Fatalf("install missing-attempt trigger: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "password"}); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("login error = %v, want ErrInvalidCredentials", err)
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 1)
	})

	t.Run("user query", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		if _, err := pool.Exec(ctx, `drop table app_user cascade`); err != nil {
			t.Fatalf("drop user table: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "password"}); err == nil {
			t.Fatal("expected user-query error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 0)
	})

	t.Run("record failure", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `
			insert into auth_login_attempt (
				username_hash, failed_attempts, window_started_at, blocked_until, updated_at
			) values ($1, 32767, clock_timestamp(), null, clock_timestamp())
		`, testLoginUsernameHash("alice")); err != nil {
			t.Fatalf("insert overflowing login attempt: %v", err)
		}

		service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool { return false })
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"}); err == nil {
			t.Fatal("expected record-failure error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 32767)
	})

	t.Run("failure commit", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `
			create function reject_deferred_login_attempt_update() returns trigger
			language plpgsql as $$
			begin
				raise exception 'forced deferred login-attempt failure';
			end
			$$;
			create constraint trigger reject_deferred_login_attempt_update
			after update on auth_login_attempt
			deferrable initially deferred
			for each row execute function reject_deferred_login_attempt_update()
		`); err != nil {
			t.Fatalf("install deferred login-attempt trigger: %v", err)
		}

		service := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool { return false })
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"}); err == nil {
			t.Fatal("expected failed-login commit error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 0)
	})

	t.Run("delete attempt", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `
			insert into auth_login_attempt (
				username_hash, failed_attempts, window_started_at, blocked_until, updated_at
			) values ($1, 4, clock_timestamp(), null, clock_timestamp())
		`, testLoginUsernameHash("alice")); err != nil {
			t.Fatalf("insert delete-failure attempt: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			create function reject_login_attempt_delete() returns trigger
			language plpgsql as $$
			begin
				raise exception 'forced login-attempt delete failure';
			end
			$$;
			create trigger reject_login_attempt_delete
			before delete on auth_login_attempt
			for each row execute function reject_login_attempt_delete()
		`); err != nil {
			t.Fatalf("install delete failure: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"}); err == nil {
			t.Fatal("expected delete-attempt error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 4)
	})

	t.Run("success commit", func(t *testing.T) {
		ctx := context.Background()
		pool := authTestPool(t, ctx)
		insertLoginGroup(t, ctx, pool)
		insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
		if _, err := pool.Exec(ctx, `
			insert into auth_login_attempt (
				username_hash, failed_attempts, window_started_at, blocked_until, updated_at
			) values ($1, 4, clock_timestamp(), null, clock_timestamp())
		`, testLoginUsernameHash("alice")); err != nil {
			t.Fatalf("insert commit-failure attempt: %v", err)
		}
		if _, err := pool.Exec(ctx, `
			create function reject_deferred_session_insert() returns trigger
			language plpgsql as $$
			begin
				raise exception 'forced deferred session failure';
			end
			$$;
			create constraint trigger reject_deferred_session_insert
			after insert on session
			deferrable initially deferred
			for each row execute function reject_deferred_session_insert()
		`); err != nil {
			t.Fatalf("install deferred session failure: %v", err)
		}

		service := auth.NewService(pool, 24*time.Hour)
		if _, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"}); err == nil {
			t.Fatal("expected successful-login commit error")
		}
		assertLoginAttemptCount(t, ctx, pool, "alice", 4)
		var sessionCount int
		if err := pool.QueryRow(ctx, `select count(*) from session`).Scan(&sessionCount); err != nil {
			t.Fatalf("count sessions after commit failure: %v", err)
		}
		if sessionCount != 0 {
			t.Fatalf("session count = %d, want 0", sessionCount)
		}
	})
}

// TestAuthServiceLoginConcurrentServicesShareRateLimit verifies multiple instances use one PostgreSQL counter.
func TestAuthServiceLoginConcurrentServicesShareRateLimit(t *testing.T) {
	pool := authTestPool(t, t.Context())
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	var verifierCalls atomic.Int32
	verifier := func(string, string) bool {
		verifierCalls.Add(1)
		return false
	}
	services := []*auth.Service{
		auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, verifier),
		auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, verifier),
	}

	results := make(chan error, 10)
	for range 5 {
		start := make(chan struct{})
		var waitGroup sync.WaitGroup
		for _, service := range services {
			waitGroup.Add(1)
			go func(service *auth.Service) {
				defer waitGroup.Done()
				<-start
				_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
				results <- err
			}(service)
		}
		close(start)
		workersDone := make(chan struct{})
		go func() {
			waitGroup.Wait()
			close(workersDone)
		}()
		select {
		case <-workersDone:
		case <-ctx.Done():
			t.Fatalf("timed out waiting for concurrent logins: %v", ctx.Err())
		}
	}
	close(results)

	invalidCount := 0
	limitedCount := 0
	for err := range results {
		switch {
		case errors.Is(err, auth.ErrInvalidCredentials):
			invalidCount++
		case errors.Is(err, auth.ErrLoginRateLimited):
			limitedCount++
		default:
			t.Fatalf("concurrent login error = %v", err)
		}
	}
	if invalidCount != 9 || limitedCount != 1 {
		t.Fatalf("concurrent results = invalid %d limited %d, want 9 and 1", invalidCount, limitedCount)
	}
	if got := verifierCalls.Load(); got != 10 {
		t.Fatalf("concurrent verifier calls = %d, want 10", got)
	}
	assertLoginAttemptCount(t, ctx, pool, "alice", 10)
}

// TestAuthServiceLoginConcurrentSuccessDeletionPreservesLockOrCreate verifies deleting a locked attempt cannot strand a waiting login.
func TestAuthServiceLoginConcurrentSuccessDeletionPreservesLockOrCreate(t *testing.T) {
	tests := []struct {
		name             string
		secondMatches    bool
		wantSecondError  error
		wantAttemptCount int16
		wantSessionCount int
	}{
		{
			name:             "success then failure",
			wantSecondError:  auth.ErrInvalidCredentials,
			wantAttemptCount: 1,
			wantSessionCount: 1,
		},
		{
			name:             "double success",
			secondMatches:    true,
			wantAttemptCount: 0,
			wantSessionCount: 2,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			pool := authTestPool(t, t.Context())
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			insertLoginGroup(t, ctx, pool)
			insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
			if _, err := pool.Exec(ctx, `
				insert into auth_login_attempt (
					username_hash, failed_attempts, window_started_at, blocked_until, updated_at
				) values ($1, 4, clock_timestamp(), null, clock_timestamp())
			`, testLoginUsernameHash("alice")); err != nil {
				t.Fatalf("insert concurrent login attempt: %v", err)
			}

			firstVerifying := make(chan struct{})
			releaseFirst := make(chan struct{})
			var releaseOnce sync.Once
			release := func() { releaseOnce.Do(func() { close(releaseFirst) }) }
			defer release()
			firstService := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool {
				close(firstVerifying)
				<-releaseFirst
				return true
			})
			secondService := auth.NewServiceWithPasswordVerifier(pool, 24*time.Hour, func(string, string) bool {
				return test.secondMatches
			})

			firstResult := make(chan error, 1)
			go func() {
				_, err := firstService.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
				firstResult <- err
			}()
			select {
			case <-firstVerifying:
			case <-ctx.Done():
				t.Fatalf("first login did not reach password verification: %v", ctx.Err())
			}

			secondResult := make(chan error, 1)
			go func() {
				_, err := secondService.Login(ctx, auth.LoginInput{Username: "alice", Password: "candidate"})
				secondResult <- err
			}()
			waitForDatabaseLock(t, ctx, pool)
			release()

			if err := receiveLoginResult(t, ctx, firstResult); err != nil {
				t.Fatalf("first login error = %v, want nil", err)
			}
			secondErr := receiveLoginResult(t, ctx, secondResult)
			if !errors.Is(secondErr, test.wantSecondError) {
				t.Fatalf("second login error = %v, want %v", secondErr, test.wantSecondError)
			}
			assertLoginAttemptCount(t, ctx, pool, "alice", test.wantAttemptCount)
			var sessionCount int
			if err := pool.QueryRow(ctx, `select count(*) from session`).Scan(&sessionCount); err != nil {
				t.Fatalf("count concurrent sessions: %v", err)
			}
			if sessionCount != test.wantSessionCount {
				t.Fatalf("session count = %d, want %d", sessionCount, test.wantSessionCount)
			}
		})
	}
}

// TestAuthServiceLoginCreatesSession verifies auth service login creates session.
func TestAuthServiceLoginCreatesSession(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")

	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if result.Session.ID == "" {
		t.Fatal("expected session id")
	}
	if result.User.Username != "alice" {
		t.Fatalf("expected alice, got %s", result.User.Username)
	}
	if result.User.GroupKey != "user" {
		t.Fatalf("expected user group, got %s", result.User.GroupKey)
	}
}

// TestAuthServiceRejectsWrongPasswordAndDisabledUser verifies auth service rejects wrong password and disabled user.
func TestAuthServiceRejectsWrongPasswordAndDisabledUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	insertLoginUser(t, ctx, pool, "disabled", "correct-password", "disabled")

	service := auth.NewService(pool, 24*time.Hour)

	_, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "wrong-password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "disabled", Password: "correct-password"})
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
}

// TestAuthServiceMeLogoutAndResolveCurrentUser verifies auth service me logout and resolve current user.
func TestAuthServiceMeLogoutAndResolveCurrentUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	guest, err := service.Me(ctx, "")
	if err != nil {
		t.Fatalf("me without session: %v", err)
	}
	if guest.Username != "guest" {
		t.Fatalf("expected guest, got %#v", guest)
	}

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	current, err := service.ResolveCurrentUser(ctx, result.Session.ID)
	if err != nil {
		t.Fatalf("resolve current user: %v", err)
	}
	if current.Username != "alice" {
		t.Fatalf("expected alice, got %s", current.Username)
	}

	if err := service.Logout(ctx, ""); err != nil {
		t.Fatalf("logout without session: %v", err)
	}
	if err := service.Logout(ctx, result.Session.ID); err != nil {
		t.Fatalf("logout: %v", err)
	}

	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrInvalidSession) {
		t.Fatalf("expected ErrInvalidSession, got %v", err)
	}
}

// TestAuthServiceMeRejectsDisabledSessionUser verifies auth service me rejects disabled session user.
func TestAuthServiceMeRejectsDisabledSessionUser(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	_, err = pool.Exec(ctx, `update app_user set status = 'disabled' where username = 'alice'`)
	if err != nil {
		t.Fatalf("disable user: %v", err)
	}

	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrUserDisabled) {
		t.Fatalf("expected ErrUserDisabled, got %v", err)
	}
}

// TestAuthServiceFindUserErrorBranches verifies auth service find user error branches.
func TestAuthServiceFindUserErrorBranches(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	insertLoginUserWithoutPassword(t, ctx, pool, "system")
	service := auth.NewService(pool, 24*time.Hour)

	_, err := service.Login(ctx, auth.LoginInput{Username: "missing", Password: "password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for missing user, got %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "system", Password: "password"})
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials for system user, got %v", err)
	}

	_, err = pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`)
	if err != nil {
		t.Fatalf("break permissions shape: %v", err)
	}

	_, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err == nil {
		t.Fatal("expected permissions decode error")
	}
}

// TestAuthServiceFindUserByIDErrorBranches verifies auth service find user by id error branches.
func TestAuthServiceFindUserByIDErrorBranches(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	_, err = pool.Exec(ctx, `update app_user set deleted_at = now() where username = 'alice'`)
	if err != nil {
		t.Fatalf("soft delete user: %v", err)
	}
	_, err = service.Me(ctx, result.Session.ID)
	if !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("expected ErrInvalidCredentials, got %v", err)
	}

	_, err = pool.Exec(ctx, `update app_user set deleted_at = null where username = 'alice'`)
	if err != nil {
		t.Fatalf("restore user: %v", err)
	}
	result, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("second login: %v", err)
	}
	_, err = pool.Exec(ctx, `update user_group set permissions = '123'::jsonb where key = 'user'`)
	if err != nil {
		t.Fatalf("break permissions shape: %v", err)
	}
	_, err = service.Me(ctx, result.Session.ID)
	if err == nil {
		t.Fatal("expected permissions decode error")
	}
}

// TestAuthServiceFindUserByIDReturnsDatabaseError verifies Me preserves a query failure after session resolution.
func TestAuthServiceFindUserByIDReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}
	if _, err := pool.Exec(ctx, `drop table app_user cascade`); err != nil {
		t.Fatalf("drop user table: %v", err)
	}
	if _, err := service.Me(ctx, result.Session.ID); err == nil {
		t.Fatal("expected current-user query error")
	}
}

// TestAuthServiceReturnsDatabaseErrors verifies auth service returns database errors.
func TestAuthServiceReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := authTestPool(t, ctx)
	insertLoginGroup(t, ctx, pool)
	insertLoginUser(t, ctx, pool, "alice", "correct-password", "active")
	service := auth.NewService(pool, 24*time.Hour)

	result, err := service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err != nil {
		t.Fatalf("login: %v", err)
	}

	pool.Close()

	_, err = service.Login(ctx, auth.LoginInput{Username: "alice", Password: "correct-password"})
	if err == nil {
		t.Fatal("expected login database error")
	}

	_, err = service.Me(ctx, result.Session.ID)
	if err == nil {
		t.Fatal("expected me database error")
	}
}

// insertLoginGroup inserts the database fixture required by the surrounding tests.
func insertLoginGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000001', 'user', 'User', '', '["short_link:create"]'::jsonb, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert login group: %v", err)
	}
}

// insertLoginUser inserts the database fixture required by the surrounding tests.
func insertLoginUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, password string, status string) {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	_, err = pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, $2, $1, '00000000-0000-0000-0000-000000000001', $3, false, now(), now())
	`, username, hash, status)
	if err != nil {
		t.Fatalf("insert login user: %v", err)
	}
}

// insertLoginUserWithoutPassword inserts the database fixture required by the surrounding tests.
func insertLoginUserWithoutPassword(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, null, $1, '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, username)
	if err != nil {
		t.Fatalf("insert login user without password: %v", err)
	}
}

// insertLoginUserWithPasswordHash inserts an account with an intentionally supplied encoded hash.
func insertLoginUserWithPasswordHash(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, passwordHash string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values (gen_random_uuid(), $1, $2, $1, '00000000-0000-0000-0000-000000000001', 'active', false, now(), now())
	`, username, passwordHash)
	if err != nil {
		t.Fatalf("insert login user with supplied password hash: %v", err)
	}
}

// waitForDatabaseLock waits until another connection in this test database is blocked on a PostgreSQL lock.
func waitForDatabaseLock(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if err := pool.QueryRow(ctx, `
			select count(*)
			from pg_stat_activity
			where datname = current_database()
				and pid <> pg_backend_pid()
				and state = 'active'
				and wait_event_type = 'Lock'
		`).Scan(&waiting); err != nil {
			t.Fatalf("inspect login lock wait: %v", err)
		}
		if waiting > 0 {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatalf("second login did not block on the login-attempt lock: %v", ctx.Err())
		}
	}
}

// receiveLoginResult returns one concurrent login result with a bounded wait.
func receiveLoginResult(t *testing.T, ctx context.Context, results <-chan error) error {
	t.Helper()
	select {
	case err := <-results:
		return err
	case <-ctx.Done():
		t.Fatalf("timed out waiting for login result: %v", ctx.Err())
		return nil
	}
}

// testLoginUsernameHash applies the production trim-only digest contract for fixture lookup.
func testLoginUsernameHash(username string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(username)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}

// assertLoginAttemptCount verifies the persisted count for one normalized username.
func assertLoginAttemptCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, expected int16) {
	t.Helper()
	var actual int16
	if err := pool.QueryRow(ctx, `
		select failed_attempts
		from auth_login_attempt
		where username_hash = $1
	`, testLoginUsernameHash(username)).Scan(&actual); err != nil {
		if expected == 0 && errors.Is(err, pgx.ErrNoRows) {
			return
		}
		t.Fatalf("read login-attempt count: %v", err)
	}
	if actual != expected {
		t.Fatalf("login-attempt count = %d, want %d", actual, expected)
	}
}

// authTestPool opens the isolated PostgreSQL database used by its test package.
func authTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	databaseURL := testdb.ProjectMigratedDatabaseURL(ctx, t)
	pool, err := appdb.OpenPool(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
