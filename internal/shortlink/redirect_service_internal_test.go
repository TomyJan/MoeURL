package shortlink

import (
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"testing/iotest"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

// TestPasswordMatchesInputValidatesBeforeHashComparison verifies invalid input never reaches Argon2 verification.
func TestPasswordMatchesInputValidatesBeforeHashComparison(t *testing.T) {
	verifierCalled := false
	verifier := func(string, string) bool {
		verifierCalled = true
		return false
	}

	if passwordMatchesInput(strings.Repeat("a", 129), "unused hash", verifier) {
		t.Fatal("out-of-range password matched")
	}
	if verifierCalled {
		t.Fatal("password verifier was called for invalid input")
	}
}

// TestWaitAccessGrantCleanupBatchPauseHonorsCancellation verifies batch pauses stop promptly when cleanup is canceled.
func TestWaitAccessGrantCleanupBatchPauseHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	if err := waitForAccessGrantCleanupBatchPause(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cleanup batch pause error = %v, want %v", err, context.Canceled)
	}
}

// TestNextPasswordFailureUsesFixedWindowAndBlocksTheFifthFailure verifies the lockout threshold and window anchor.
func TestNextPasswordFailureUsesFixedWindowAndBlocksTheFifthFailure(t *testing.T) {
	if passwordFailureWindow != 15*time.Minute || passwordBlockDuration != 15*time.Minute {
		t.Fatalf("password failure window and block duration must both be 15 minutes")
	}
	now := time.Date(2026, time.August, 4, 10, 0, 0, 0, time.UTC)
	windowStart := now.Add(-5 * time.Minute)

	update := nextPasswordFailure(now, 4, pgtype.Timestamptz{Time: windowStart, Valid: true})
	if update.attempts != 5 {
		t.Fatalf("attempts = %d, want 5", update.attempts)
	}
	if !update.windowStartedAt.Valid || !update.windowStartedAt.Time.Equal(windowStart) {
		t.Fatalf("window start = %#v, want %v", update.windowStartedAt, windowStart)
	}
	if !update.blockedUntil.Valid || !update.blockedUntil.Time.Equal(now.Add(passwordBlockDuration)) {
		t.Fatalf("blocked until = %#v", update.blockedUntil)
	}
}

// TestNextPasswordFailureStartsANewWindowAfterExpiry verifies expired counters do not leak into a new failure window.
func TestNextPasswordFailureStartsANewWindowAfterExpiry(t *testing.T) {
	if passwordFailureWindow != 15*time.Minute || passwordBlockDuration != 15*time.Minute {
		t.Fatalf("password failure window and block duration must both be 15 minutes")
	}
	now := time.Date(2026, time.August, 4, 10, 0, 0, 0, time.UTC)
	update := nextPasswordFailure(now, 4, pgtype.Timestamptz{Time: now.Add(-passwordFailureWindow), Valid: true})
	if update.attempts != 1 || !update.windowStartedAt.Time.Equal(now) || update.blockedUntil.Valid {
		t.Fatalf("unexpected reset window update: %#v", update)
	}
}

// TestHasValidAccessGrantRequiresToken verifies empty cookies are rejected before any database lookup.
func TestHasValidAccessGrantRequiresToken(t *testing.T) {
	valid, err := (&RedirectService{}).hasValidAccessGrant(t.Context(), pgtype.UUID{}, "")
	if err != nil || valid {
		t.Fatalf("empty access token result = %t, error %v", valid, err)
	}
}

// TestGenerateAccessTokenSeparatesRawTokenFromStoredHash verifies only a digest is suitable for persistence.
func TestGenerateAccessTokenSeparatesRawTokenFromStoredHash(t *testing.T) {
	token, tokenHash, err := (&RedirectService{}).generateAccessToken()
	if err != nil {
		t.Fatalf("generate access token: %v", err)
	}
	decoded, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("decode access token: %v", err)
	}
	if len(decoded) != accessTokenBytes {
		t.Fatalf("token bytes = %d, want %d", len(decoded), accessTokenBytes)
	}
	if token == tokenHash {
		t.Fatal("raw token must differ from stored hash")
	}
	if hashAccessToken(token) != tokenHash {
		t.Fatal("stored token hash is not reproducible")
	}
}

// TestGenerateAccessTokenReturnsRandomSourceError verifies entropy failures are surfaced without issuing a token.
func TestGenerateAccessTokenReturnsRandomSourceError(t *testing.T) {
	expected := errors.New("random source failed")
	service := &RedirectService{accessTokenRandomReader: iotest.ErrReader(expected)}

	token, tokenHash, err := service.generateAccessToken()
	if !errors.Is(err, expected) {
		t.Fatalf("generate access token error = %v, want %v", err, expected)
	}
	if token != "" || tokenHash != "" {
		t.Fatalf(
			"failed token generation returned token_present=%t hash_present=%t",
			token != "",
			tokenHash != "",
		)
	}
}
