package shortlink

import (
	"encoding/base64"
	"errors"
	"testing"
	"testing/iotest"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

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
	token, tokenHash, err := generateAccessToken()
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
	original := accessTokenRandomReader
	accessTokenRandomReader = iotest.ErrReader(expected)
	t.Cleanup(func() { accessTokenRandomReader = original })

	token, tokenHash, err := generateAccessToken()
	if !errors.Is(err, expected) {
		t.Fatalf("generate access token error = %v, want %v", err, expected)
	}
	if token != "" || tokenHash != "" {
		t.Fatalf("failed token generation returned token=%q hash=%q", token, tokenHash)
	}
}
