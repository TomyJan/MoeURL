package shortlink_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestRedirectServiceResolvesActiveShortLink verifies active links resolve to their target.
func TestRedirectServiceResolvesActiveShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	result, err := service.Open(ctx, "abc123")
	if err != nil {
		t.Fatalf("resolve redirect: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
	if result.ShortLinkID == "" {
		t.Fatal("expected short link id")
	}
	if result.RedirectMode != shortlink.RedirectModeDirect {
		t.Fatalf("expected direct redirect mode, got %q", result.RedirectMode)
	}
	assertEvents(t, recorder.types, []string{
		event.ShortLinkOpened,
		event.AccessConditionChecked,
		event.RedirectInitiated,
	})
}

// TestRedirectServiceNormalizesSlugBeforeLookup verifies slug lookups are case-insensitive.
func TestRedirectServiceNormalizesSlugBeforeLookup(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "abc123", "https://example.com/target", "active", false)
	service := shortlink.NewRedirectService(pool, nil)

	result, err := service.Open(ctx, "AbC123")
	if err != nil {
		t.Fatalf("resolve mixed-case slug: %v", err)
	}
	if result.TargetURL != "https://example.com/target" {
		t.Fatalf("expected target url, got %q", result.TargetURL)
	}
}

// TestRedirectServiceBlocksMissingAndDisabledShortLink verifies missing and disabled links do not resolve.
func TestRedirectServiceBlocksMissingAndDisabledShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled", "https://example.com/disabled", "disabled", false)

	tests := []struct {
		name   string
		slug   string
		err    error
		events []string
	}{
		{
			name: "missing",
			slug: "missing",
			err:  shortlink.ErrShortLinkMissing,
			events: []string{
				event.AccessConditionChecked,
				event.RedirectBlocked,
			},
		},
		{
			name: "disabled",
			slug: "disabled",
			err:  shortlink.ErrShortLinkDisabled,
			events: []string{
				event.ShortLinkOpened,
				event.AccessConditionChecked,
				event.RedirectBlocked,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := &recordingRecorder{}
			service := shortlink.NewRedirectService(pool, recorder)

			_, err := service.Open(ctx, tt.slug)
			if !errors.Is(err, tt.err) {
				t.Fatalf("expected %v, got %v", tt.err, err)
			}
			assertEvents(t, recorder.types, tt.events)
		})
	}
}

// TestRedirectServiceDoesNotRecordSuccessfulResponseEvent verifies handlers own success events.
func TestRedirectServiceDoesNotRecordSuccessfulResponseEvent(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "active1", "https://example.com/target", "active", false)
	service := shortlink.NewRedirectService(pool, nil)

	_, err := service.Open(ctx, "active1")
	if err != nil {
		t.Fatalf("resolve active link: %v", err)
	}

	var allVisits int
	err = pool.QueryRow(ctx, `select count(*) from short_link_event where event_type = $1`, event.RedirectResponseSent).Scan(&allVisits)
	if err != nil {
		t.Fatalf("query all visits: %v", err)
	}
	if allVisits != 0 {
		t.Fatalf("expected service not to record successful response event, got %d", allVisits)
	}
}

// TestRedirectServiceReturnsDatabaseError verifies resolution returns query failures.
func TestRedirectServiceReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewRedirectService(pool, nil)
	pool.Close()

	_, err := service.Open(ctx, "abc123")
	if err == nil {
		t.Fatal("expected open database error")
	}
	_, err = service.Preview(ctx, "abc123", "")
	if err == nil {
		t.Fatal("expected preview database error")
	}
	_, err = service.Continue(ctx, "abc123", "")
	if err == nil {
		t.Fatal("expected continue database error")
	}
}

// TestRedirectServiceIntermediatePreviewAndContinue verifies the three public access actions and event boundaries.
func TestRedirectServiceIntermediatePreviewAndContinue(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "middle", "https://example.com/docs/path", "active", false)
	expiresAt := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	_, err := pool.Exec(ctx, `
		update short_link
		set redirect_mode = 'intermediate', intermediate_delay_seconds = 7, expires_at = $2
		where id = $1
	`, linkID, expiresAt)
	if err != nil {
		t.Fatalf("configure intermediate short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	opened, err := service.Open(ctx, "MiDdLe")
	if err != nil {
		t.Fatalf("open intermediate short link: %v", err)
	}
	if opened.RedirectMode != shortlink.RedirectModeIntermediate || opened.Slug != "middle" || opened.TargetURL != "" || opened.ShortLinkID == "" {
		t.Fatalf("unexpected intermediate open result: %#v", opened)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked})

	recorder.types = nil
	preview, err := service.Preview(ctx, "MIDDLE", "")
	if err != nil {
		t.Fatalf("preview intermediate short link: %v", err)
	}
	if preview.Slug != "middle" || preview.TargetHost != "example.com" || preview.IntermediateDelaySeconds == nil || *preview.IntermediateDelaySeconds != 7 || preview.ExpiresAt == nil || !preview.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected intermediate preview: %#v", preview)
	}
	if preview.RedirectMode != shortlink.RedirectModeIntermediate {
		t.Fatalf("expected explicit intermediate preview mode, got %#v", preview)
	}
	if len(recorder.types) != 0 {
		t.Fatalf("expected preview not to write events, got %#v", recorder.types)
	}
	_, err = pool.Exec(ctx, `update short_link set expires_at = null where id = $1`, linkID)
	if err != nil {
		t.Fatalf("clear intermediate expiration: %v", err)
	}
	preview, err = service.Preview(ctx, "middle", "")
	if err != nil || preview.ExpiresAt != nil {
		t.Fatalf("expected preview without expiration, got result %#v error %v", preview, err)
	}

	continued, err := service.Continue(ctx, "middle", "")
	if err != nil {
		t.Fatalf("continue intermediate short link: %v", err)
	}
	if continued.TargetURL != "https://example.com/docs/path" || continued.ShortLinkID == "" {
		t.Fatalf("unexpected continued redirect: %#v", continued)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.RedirectInitiated})
}

// TestRedirectServiceConfirmationPreviewAndContinue verifies confirmation waits for an explicit final action.
func TestRedirectServiceConfirmationPreviewAndContinue(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "confirmation-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "confirm1", "https://example.com/confirm/path", "active", false)
	if _, err := pool.Exec(ctx, `update short_link set redirect_mode = 'confirmation' where id = $1`, linkID); err != nil {
		t.Fatalf("configure confirmation short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	opened, err := service.Open(ctx, "CoNfIrM1")
	if err != nil {
		t.Fatalf("open confirmation short link: %v", err)
	}
	if opened.RedirectMode != shortlink.RedirectModeConfirmation || opened.Slug != "confirm1" || opened.TargetURL != "" || opened.ShortLinkID == "" {
		t.Fatalf("unexpected confirmation open result: %#v", opened)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked})

	recorder.types = nil
	preview, err := service.Preview(ctx, "CONFIRM1", "")
	if err != nil {
		t.Fatalf("preview confirmation short link: %v", err)
	}
	if preview.Slug != "confirm1" || preview.TargetHost != "example.com" || preview.RedirectMode != shortlink.RedirectModeConfirmation || preview.IntermediateDelaySeconds != nil {
		t.Fatalf("unexpected confirmation preview: %#v", preview)
	}
	if len(recorder.types) != 0 {
		t.Fatalf("expected confirmation preview not to write events, got %#v", recorder.types)
	}

	continued, err := service.Continue(ctx, "confirm1", "")
	if err != nil {
		t.Fatalf("continue confirmation short link: %v", err)
	}
	if continued.TargetURL != "https://example.com/confirm/path" || continued.ShortLinkID == "" {
		t.Fatalf("unexpected confirmation redirect: %#v", continued)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.ConfirmationClicked, event.RedirectInitiated})

	recorder.types = nil
	if _, err := pool.Exec(ctx, `update short_link set status = 'disabled' where id = $1`, linkID); err != nil {
		t.Fatalf("disable confirmation short link: %v", err)
	}
	if _, err := service.Continue(ctx, "confirm1", ""); !errors.Is(err, shortlink.ErrShortLinkDisabled) {
		t.Fatalf("expected disabled confirmation continue rejection, got %v", err)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.RedirectBlocked})
}

// TestRedirectServiceProtectedConfirmationKeepsModeAfterUnlock verifies a grant does not bypass confirmation.
func TestRedirectServiceProtectedConfirmationKeepsModeAfterUnlock(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "protected-confirmation-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "secure-confirm", "https://example.com/protected-confirmation", "active", false)
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected confirmation password: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		update short_link
		set redirect_mode = 'confirmation', password_hash = $2, password_updated_at = now()
		where id = $1
	`, linkID, hash); err != nil {
		t.Fatalf("configure protected confirmation short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	opened, err := service.Open(ctx, "secure-confirm")
	if err != nil || !opened.RequiresPassword || opened.RedirectMode != shortlink.RedirectModeConfirmation {
		t.Fatalf("expected protected confirmation open, got %#v error %v", opened, err)
	}
	grant, err := service.Unlock(ctx, "secure-confirm", "correct horse")
	if err != nil {
		t.Fatalf("unlock protected confirmation: %v", err)
	}
	preview, err := service.Preview(ctx, "secure-confirm", grant.Token)
	if err != nil || preview.RedirectMode != shortlink.RedirectModeConfirmation || preview.IntermediateDelaySeconds != nil {
		t.Fatalf("expected authorized confirmation preview, got %#v error %v", preview, err)
	}
	recorder.types = nil
	continued, err := service.Continue(ctx, "secure-confirm", grant.Token)
	if err != nil || continued.TargetURL != "https://example.com/protected-confirmation" {
		t.Fatalf("continue protected confirmation: %#v error %v", continued, err)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.ConfirmationClicked, event.RedirectInitiated})
}

// TestRedirectServiceProtectedDirectFlowUsesGrantAndRateLimit verifies unlock, grant reuse, and lockout as one flow.
func TestRedirectServiceProtectedDirectFlowUsesGrantAndRateLimit(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "protected-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "protected", "https://example.com/protected", "active", false)
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_hash = $2, password_updated_at = now() where id = $1`, linkID, hash); err != nil {
		t.Fatalf("configure protected password: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)

	opened, err := service.Open(ctx, "PROTECTED")
	if err != nil || !opened.RequiresPassword || opened.TargetURL != "" {
		t.Fatalf("expected password-gated open, got %#v error %v", opened, err)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked})
	recorder.types = nil
	preview, err := service.Preview(ctx, "protected", "")
	if !errors.Is(err, shortlink.ErrPasswordRequired) || preview != (shortlink.PreviewResult{}) {
		t.Fatalf("expected protected preview to require authorization, got %#v error %v", preview, err)
	}
	if len(recorder.types) != 0 {
		t.Fatalf("expected preview without events, got %#v", recorder.types)
	}
	_, err = service.Continue(ctx, "protected", "")
	if !errors.Is(err, shortlink.ErrPasswordRequired) {
		t.Fatalf("expected missing grant error, got %v", err)
	}
	_, err = service.Unlock(ctx, "protected", "")
	if !errors.Is(err, shortlink.ErrPasswordRequired) {
		t.Fatalf("expected missing password error, got %v", err)
	}

	for attempt := 1; attempt <= 5; attempt++ {
		_, err = service.Unlock(ctx, "protected", "wrong password")
		want := shortlink.ErrInvalidPassword
		if attempt == 5 {
			want = shortlink.ErrPasswordRateLimited
		}
		if !errors.Is(err, want) {
			t.Fatalf("attempt %d error = %v, want %v", attempt, err, want)
		}
		if attempt == 5 {
			var rateLimitErr *shortlink.PasswordRateLimitedError
			if !errors.As(err, &rateLimitErr) || !rateLimitErr.RetryAt.After(time.Now()) {
				t.Fatalf("expected rate-limit retry deadline, got %v", err)
			}
		}
	}
	if _, err := pool.Exec(ctx, `update short_link set password_blocked_until = now() - interval '1 second' where id = $1`, linkID); err != nil {
		t.Fatalf("expire password block fixture: %v", err)
	}
	grant, err := service.Unlock(ctx, "protected", "correct horse")
	if err != nil || grant.Token == "" {
		t.Fatalf("expected successful unlock grant, token_present=%t error %v", grant.Token != "", err)
	}
	var failedAttempts int32
	var windowStartedAt pgtype.Timestamptz
	var blockedUntil pgtype.Timestamptz
	if err := pool.QueryRow(ctx, `
		select password_failed_attempts, password_window_started_at, password_blocked_until
		from short_link where id = $1
	`, linkID).Scan(&failedAttempts, &windowStartedAt, &blockedUntil); err != nil {
		t.Fatalf("query password failure state after successful unlock: %v", err)
	}
	if failedAttempts != 0 || windowStartedAt.Valid || blockedUntil.Valid {
		t.Fatalf("successful unlock did not reset password failure state")
	}
	continued, err := service.Continue(ctx, "protected", grant.Token)
	if err != nil || continued.TargetURL != "https://example.com/protected" {
		t.Fatalf("expected granted redirect, got %#v error %v", continued, err)
	}
	authorizedPreview, err := service.Preview(ctx, "protected", grant.Token)
	if err != nil || authorizedPreview.TargetHost != "example.com" {
		t.Fatalf("expected protected preview metadata, got %#v error %v", authorizedPreview, err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_updated_at = now() where id = $1`, linkID); err != nil {
		t.Fatalf("invalidate protected grant: %v", err)
	}
	if _, err := service.Continue(ctx, "protected", grant.Token); !errors.Is(err, shortlink.ErrPasswordRequired) {
		t.Fatalf("expected password update to invalidate old grant, got %v", err)
	}
}

// TestRedirectServiceUnlockRejectsOutOfRangePassword verifies invalid lengths never unlock a short link.
func TestRedirectServiceUnlockRejectsOutOfRangePassword(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "oversized-password-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "oversized-password", "https://example.com/protected", "active", false)
	oversizedPassword := strings.Repeat("a", 129)
	hash, err := auth.HashPassword(oversizedPassword)
	if err != nil {
		t.Fatalf("hash oversized password fixture: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_hash = $2, password_updated_at = now() where id = $1`, linkID, hash); err != nil {
		t.Fatalf("configure oversized password fixture: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	for attempt := 1; attempt <= 5; attempt++ {
		_, err := service.Unlock(ctx, "oversized-password", oversizedPassword)
		want := shortlink.ErrInvalidPassword
		if attempt == 5 {
			want = shortlink.ErrPasswordRateLimited
		}
		if !errors.Is(err, want) {
			t.Fatalf("attempt %d error = %v, want %v", attempt, err, want)
		}
	}

	var grantCount int
	if err := pool.QueryRow(ctx, `select count(*) from short_link_access_grant where short_link_id = $1`, linkID).Scan(&grantCount); err != nil {
		t.Fatalf("count oversized-password grants: %v", err)
	}
	if grantCount != 0 {
		t.Fatalf("expected no grant for oversized password, got %d", grantCount)
	}
}

// TestRedirectServicePropagatesAccessGrantQueryErrors verifies storage failures are not mistaken for invalid grants.
func TestRedirectServicePropagatesAccessGrantQueryErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "grant-query-error-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "grant-query-error", "https://example.com/protected", "active", false)
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_hash = $2 where id = $1`, linkID, hash); err != nil {
		t.Fatalf("configure protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `drop table short_link_access_grant`); err != nil {
		t.Fatalf("drop access grant table: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	if _, err := service.Preview(ctx, "grant-query-error", "raw-token"); err == nil {
		t.Fatal("expected preview access grant query error")
	}
	if _, err := service.Continue(ctx, "grant-query-error", "raw-token"); err == nil {
		t.Fatal("expected continue access grant query error")
	}
}

// TestRedirectServiceUnlockMapsAccessConditions verifies unavailable links cannot issue access grants.
func TestRedirectServiceUnlockMapsAccessConditions(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "unlock-conditions-user", "user", []string{})
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected password: %v", err)
	}

	insertStoredShortLink(t, ctx, pool, user.ID, "unlock-unprotected", "https://example.com/unprotected", "active", false)
	disabledID := insertStoredShortLink(t, ctx, pool, user.ID, "unlock-disabled", "https://example.com/disabled", "disabled", false)
	expiredID := insertStoredShortLink(t, ctx, pool, user.ID, "unlock-expired", "https://example.com/expired", "active", false)
	blockedID := insertStoredShortLink(t, ctx, pool, user.ID, "unlock-blocked", "https://example.com/blocked", "active", false)
	for _, linkID := range []string{disabledID, expiredID, blockedID} {
		if _, err := pool.Exec(ctx, `update short_link set password_hash = $2 where id = $1`, linkID, hash); err != nil {
			t.Fatalf("configure protected password: %v", err)
		}
	}
	if _, err := pool.Exec(ctx, `update short_link set expires_at = now() - interval '1 second' where id = $1`, expiredID); err != nil {
		t.Fatalf("expire protected link: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_blocked_until = now() + interval '1 minute' where id = $1`, blockedID); err != nil {
		t.Fatalf("block protected link: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	tests := []struct {
		name string
		slug string
		want error
	}{
		{name: "missing", slug: "unlock-missing", want: shortlink.ErrShortLinkMissing},
		{name: "unprotected", slug: "unlock-unprotected", want: shortlink.ErrInvalidPassword},
		{name: "disabled", slug: "unlock-disabled", want: shortlink.ErrShortLinkDisabled},
		{name: "expired", slug: "unlock-expired", want: shortlink.ErrShortLinkExpired},
		{name: "rate limited", slug: "unlock-blocked", want: shortlink.ErrPasswordRateLimited},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Unlock(ctx, test.slug, "correct horse")
			if !errors.Is(err, test.want) {
				t.Fatalf("expected %v, got %v", test.want, err)
			}
		})
	}
}

// TestRedirectServiceUnlockHandlesUnavailableDatabase verifies transaction startup failures are returned to the handler.
func TestRedirectServiceUnlockHandlesUnavailableDatabase(t *testing.T) {
	ctx := context.Background()
	unavailableService := shortlink.NewRedirectService(nil, nil)
	if _, err := unavailableService.Unlock(ctx, "missing", "password"); err == nil {
		t.Fatal("expected unavailable database error")
	}
	if err := unavailableService.CleanupExpiredAccessGrants(ctx, nil); err == nil {
		t.Fatal("expected unavailable cleanup database error")
	}

	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewRedirectService(pool, nil)
	pool.Close()
	if _, err := service.Unlock(ctx, "missing", "password"); err == nil {
		t.Fatal("expected begin transaction error")
	}
}

// TestRedirectServiceUnlockReturnsPasswordStateQueryError verifies locked lookup failures are surfaced.
func TestRedirectServiceUnlockReturnsPasswordStateQueryError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	if _, err := pool.Exec(ctx, `drop table short_link cascade`); err != nil {
		t.Fatalf("remove short link table fixture: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	if _, err := service.Unlock(ctx, "query-error", "correct horse"); err == nil {
		t.Fatal("expected password-state query error")
	}
}

// TestRedirectServiceUnlockReturnsAccessGrantCreationError verifies grant persistence failures are surfaced.
func TestRedirectServiceUnlockReturnsAccessGrantCreationError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "grant-create-error-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "grant-create-error", "https://example.com/protected", "active", false)
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_hash = $2 where id = $1`, linkID, hash); err != nil {
		t.Fatalf("configure protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `drop table short_link_access_grant`); err != nil {
		t.Fatalf("remove access grant table fixture: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	if _, err := service.Unlock(ctx, "grant-create-error", "correct horse"); err == nil {
		t.Fatal("expected access-grant creation error")
	}
}

// TestRedirectServiceCleanupReturnsDeletionError verifies cleanup query failures are surfaced.
func TestRedirectServiceCleanupReturnsDeletionError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	if _, err := pool.Exec(ctx, `drop table short_link_access_grant`); err != nil {
		t.Fatalf("remove access grant table fixture: %v", err)
	}

	service := shortlink.NewRedirectService(pool, nil)
	if err := service.CleanupExpiredAccessGrants(ctx, nil); err == nil {
		t.Fatal("expected cleanup deletion error")
	}
	canceledContext, cancel := context.WithCancel(ctx)
	cancel()
	if err := service.CleanupExpiredAccessGrants(canceledContext, nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("cleanup canceled context error = %v, want %v", err, context.Canceled)
	}
}

// TestRedirectServiceCleanupDefendsInvalidRuntimeParameters verifies background cleanup does not panic on invalid optional inputs.
func TestRedirectServiceCleanupDefendsInvalidRuntimeParameters(t *testing.T) {
	invalidIntervalDone := make(chan struct{})
	go func() {
		defer close(invalidIntervalDone)
		shortlink.NewRedirectService(nil, nil).RunAccessGrantCleanup(context.Background(), 0, nil)
	}()
	select {
	case <-invalidIntervalDone:
	case <-time.After(time.Second):
		t.Fatal("cleanup with invalid interval did not return")
	}

	cleanupContext, cancelCleanup := context.WithCancel(context.Background())
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		shortlink.NewRedirectService(nil, nil).RunAccessGrantCleanup(cleanupContext, time.Millisecond, nil)
	}()
	time.Sleep(10 * time.Millisecond)
	cancelCleanup()
	select {
	case <-cleanupDone:
	case <-time.After(time.Second):
		t.Fatal("cleanup with nil logger did not stop")
	}
}

// accessGrantCleanupFixture owns the shared link state for cleanup behavior tests.
type accessGrantCleanupFixture struct {
	ctx     context.Context
	pool    *pgxpool.Pool
	linkID  string
	service *shortlink.RedirectService
}

// newAccessGrantCleanupFixture creates one protected link and its redirect service.
func newAccessGrantCleanupFixture(t *testing.T) accessGrantCleanupFixture {
	t.Helper()
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "protected-cleanup-user", "user", []string{})
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "protected-cleanup", "https://example.com/protected", "active", false)
	hash, err := auth.HashPassword("correct horse")
	if err != nil {
		t.Fatalf("hash protected password: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set password_hash = $2, password_updated_at = now() where id = $1`, linkID, hash); err != nil {
		t.Fatalf("configure protected password: %v", err)
	}
	return accessGrantCleanupFixture{
		ctx:     ctx,
		pool:    pool,
		linkID:  linkID,
		service: shortlink.NewRedirectService(pool, nil),
	}
}

// insertExpiredGrants adds the requested number of expired grants to the fixture link.
func (fixture accessGrantCleanupFixture) insertExpiredGrants(t *testing.T, count int) {
	t.Helper()
	if _, err := fixture.pool.Exec(fixture.ctx, `
		insert into short_link_access_grant (id, short_link_id, token_hash, expires_at, created_at)
		select ('00000000-0000-0001-0000-' || lpad(value::text, 12, '0'))::uuid,
			$1, 'expired-grant-' || value, now() - interval '1 second', now() - interval '1 minute'
		from generate_series(1, $2) as value
	`, fixture.linkID, count); err != nil {
		t.Fatalf("insert expired access grant: %v", err)
	}
}

// expiredGrantCount returns the number of grants currently eligible for cleanup.
func (fixture accessGrantCleanupFixture) expiredGrantCount(t *testing.T) int {
	t.Helper()
	var count int
	if err := fixture.pool.QueryRow(fixture.ctx, `select count(*) from short_link_access_grant where expires_at <= now()`).Scan(&count); err != nil {
		t.Fatalf("query expired access grants: %v", err)
	}
	return count
}

// TestRedirectServiceUnlockDoesNotCleanExpiredAccessGrants verifies unlock stays independent from maintenance work.
func TestRedirectServiceUnlockDoesNotCleanExpiredAccessGrants(t *testing.T) {
	fixture := newAccessGrantCleanupFixture(t)
	fixture.insertExpiredGrants(t, 1)

	grant, err := fixture.service.Unlock(fixture.ctx, "protected-cleanup", "correct horse")
	if err != nil {
		t.Fatalf("unlock protected short link: %v", err)
	}
	if grant.Token == "" {
		t.Fatal("unlock returned an empty access token")
	}
	if expiredCount := fixture.expiredGrantCount(t); expiredCount != 1 {
		t.Fatalf("expected unlock to leave the expired grant, got %d rows", expiredCount)
	}
}

// TestRedirectServiceCleanupDrainsExpiredGrantBatchesAndLogs verifies one cleanup drains every bounded batch.
func TestRedirectServiceCleanupDrainsExpiredGrantBatchesAndLogs(t *testing.T) {
	fixture := newAccessGrantCleanupFixture(t)
	cleanupBatchSize := int(shortlink.AccessGrantCleanupBatchSize)
	totalGrantCount := cleanupBatchSize + 1
	expectedBatchCount := (totalGrantCount + cleanupBatchSize - 1) / cleanupBatchSize
	// A full batch plus one remaining row exercises the cleanup batch boundary.
	fixture.insertExpiredGrants(t, totalGrantCount)

	logOutput := &bytes.Buffer{}
	cleanupLogger := slog.New(slog.NewTextHandler(logOutput, nil))
	if err := fixture.service.CleanupExpiredAccessGrants(fixture.ctx, cleanupLogger); err != nil {
		t.Fatalf("clean expired access grants: %v", err)
	}
	if expiredCount := fixture.expiredGrantCount(t); expiredCount != 0 {
		t.Fatalf("expected one cleanup invocation to drain expired access grants, got %d rows", expiredCount)
	}
	cleanupLog := logOutput.String()
	for _, field := range []string{
		"access_grant_cleanup_completed",
		fmt.Sprintf("deleted_rows=%d", totalGrantCount),
		fmt.Sprintf("batch_count=%d", expectedBatchCount),
		"duration_ms=",
		"index=short_link_access_grant_expiry_idx",
	} {
		if !strings.Contains(cleanupLog, field) {
			t.Fatalf("expected cleanup log field %q, got %q", field, cleanupLog)
		}
	}
}

// TestRedirectServiceCleanupCapsExpiredGrantBatches verifies one run leaves work for the next scheduled cycle after its batch limit.
func TestRedirectServiceCleanupCapsExpiredGrantBatches(t *testing.T) {
	fixture := newAccessGrantCleanupFixture(t)
	totalGrantCount := int(shortlink.AccessGrantCleanupBatchSize)*shortlink.AccessGrantCleanupMaxBatches + 1
	fixture.insertExpiredGrants(t, totalGrantCount)
	logOutput := &bytes.Buffer{}
	cleanupLogger := slog.New(slog.NewTextHandler(logOutput, nil))

	if err := fixture.service.CleanupExpiredAccessGrants(fixture.ctx, cleanupLogger); err != nil {
		t.Fatalf("clean expired access grants: %v", err)
	}
	if expiredCount := fixture.expiredGrantCount(t); expiredCount != 1 {
		t.Fatalf("expected cleanup to cap at %d batches and leave one expired grant, got %d rows", shortlink.AccessGrantCleanupMaxBatches, expiredCount)
	}
	cleanupLog := logOutput.String()
	for _, field := range []string{
		"access_grant_cleanup_completed",
		fmt.Sprintf("deleted_rows=%d", int64(shortlink.AccessGrantCleanupBatchSize)*int64(shortlink.AccessGrantCleanupMaxBatches)),
		fmt.Sprintf("batch_count=%d", shortlink.AccessGrantCleanupMaxBatches),
		"batch_limit_reached=true",
	} {
		if !strings.Contains(cleanupLog, field) {
			t.Fatalf("expected cleanup log field %q, got %q", field, cleanupLog)
		}
	}
}

// TestRedirectServiceCleanupReturnsCancellationDuringBatchPause verifies cancellation interrupts the pause before the next batch.
func TestRedirectServiceCleanupReturnsCancellationDuringBatchPause(t *testing.T) {
	fixture := newAccessGrantCleanupFixture(t)
	fixture.insertExpiredGrants(t, int(shortlink.AccessGrantCleanupBatchSize))
	cleanupCtx, cancel := context.WithCancel(fixture.ctx)
	defer cancel()
	pauseEntered := make(chan struct{})
	fixture.service.SetAccessGrantCleanupPauseHook(func(ctx context.Context) error {
		close(pauseEntered)
		<-ctx.Done()
		return ctx.Err()
	})
	cleanupDone := make(chan error, 1)
	go func() {
		cleanupDone <- fixture.service.CleanupExpiredAccessGrants(cleanupCtx, nil)
	}()

	select {
	case <-pauseEntered:
	case <-time.After(5 * time.Second):
		t.Fatal("cleanup did not enter the inter-batch pause")
	}
	cancel()

	select {
	case err := <-cleanupDone:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cleanup cancellation error = %v, want %v", err, context.Canceled)
		}
	case <-time.After(time.Second):
		t.Fatal("cleanup did not stop during the batch pause")
	}
}

// TestRedirectServiceRunsPeriodicAccessGrantCleanup verifies maintenance runs at startup and preserves active grants.
func TestRedirectServiceRunsPeriodicAccessGrantCleanup(t *testing.T) {
	fixture := newAccessGrantCleanupFixture(t)
	fixture.insertExpiredGrants(t, 1)
	grant, err := fixture.service.Unlock(fixture.ctx, "protected-cleanup", "correct horse")
	if err != nil {
		t.Fatalf("unlock protected short link: %v", err)
	}
	if grant.Token == "" {
		t.Fatal("unlock returned an empty access token")
	}

	cleanupCtx, cancelCleanup := context.WithCancel(fixture.ctx)
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		fixture.service.RunAccessGrantCleanup(cleanupCtx, time.Hour, slog.Default())
	}()
	expiredCount := 1
	deadline := time.Now().Add(5 * time.Second)
	for expiredCount != 0 && time.Now().Before(deadline) {
		expiredCount = fixture.expiredGrantCount(t)
		time.Sleep(time.Millisecond)
	}
	cancelCleanup()
	<-cleanupDone
	if expiredCount != 0 {
		t.Fatalf("expected periodic cleanup to remove the remaining expired grant, got %d rows", expiredCount)
	}

	var activeCount int
	if err := fixture.pool.QueryRow(fixture.ctx, `select count(*) from short_link_access_grant where short_link_id = $1 and expires_at > now()`, fixture.linkID).Scan(&activeCount); err != nil {
		t.Fatalf("query active access grants: %v", err)
	}
	if activeCount != 1 {
		t.Fatalf("expected new access grant to remain, got %d rows", activeCount)
	}
}

// TestRedirectServiceLogsAccessGrantCleanupFailures verifies background cleanup errors remain observable.
func TestRedirectServiceLogsAccessGrantCleanupFailures(t *testing.T) {
	logOutput := &notifyingLogWriter{written: make(chan struct{})}
	logger := slog.New(slog.NewTextHandler(logOutput, nil))

	cleanupContext, cancelCleanup := context.WithCancel(context.Background())
	cleanupDone := make(chan struct{})
	go func() {
		defer close(cleanupDone)
		shortlink.NewRedirectService(nil, nil).RunAccessGrantCleanup(cleanupContext, time.Millisecond, logger)
	}()
	select {
	case <-logOutput.written:
	case <-time.After(time.Second):
	}
	cancelCleanup()
	<-cleanupDone

	output := logOutput.String()
	if !strings.Contains(output, "access_grant_cleanup_failed") || !strings.Contains(output, "redirect service database is unavailable") {
		t.Fatalf("expected cleanup error context in log, got %q", output)
	}
}

// TestRedirectServicePreviewRejectsCorruptStoredTargets verifies unexpected legacy data stays an internal error.
func TestRedirectServicePreviewRejectsCorruptStoredTargets(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	invalidID := insertStoredShortLink(t, ctx, pool, user.ID, "invalid1", "https://example.com/valid", "active", false)
	hostlessID := insertStoredShortLink(t, ctx, pool, user.ID, "hostless", "https://example.com/valid", "active", false)
	if _, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', target_url = '%' where id = $1`, invalidID); err != nil {
		t.Fatalf("configure invalid stored target: %v", err)
	}
	if _, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', target_url = '/relative' where id = $1`, hostlessID); err != nil {
		t.Fatalf("configure hostless stored target: %v", err)
	}
	service := shortlink.NewRedirectService(pool, nil)

	if _, err := service.Preview(ctx, "invalid1", ""); err == nil || !strings.Contains(err.Error(), "parse stored target URL") {
		t.Fatalf("expected stored target parse error, got %v", err)
	}
	if _, err := service.Preview(ctx, "hostless", ""); err == nil || !strings.Contains(err.Error(), "no hostname") {
		t.Fatalf("expected stored target hostname error, got %v", err)
	}
}

// TestRedirectServiceBlocksExpiredAndInvalidPreviewLinks verifies lifecycle checks apply to every public action.
func TestRedirectServiceBlocksExpiredAndInvalidPreviewLinks(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	expiredID := insertStoredShortLink(t, ctx, pool, user.ID, "expired", "https://example.com/expired", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "direct1", "https://example.com/direct", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted", "https://example.com/deleted", "active", true)
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled2", "https://example.com/disabled", "disabled", false)
	_, err := pool.Exec(ctx, `update short_link set redirect_mode = 'intermediate', expires_at = now() - interval '1 second' where id = $1`, expiredID)
	if err != nil {
		t.Fatalf("expire short link: %v", err)
	}
	recorder := &recordingRecorder{}
	service := shortlink.NewRedirectService(pool, recorder)
	_, err = service.Open(ctx, "expired")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) {
		t.Fatalf("expected expired open error, got %v", err)
	}
	assertEvents(t, recorder.types, []string{event.ShortLinkOpened, event.AccessConditionChecked, event.RedirectBlocked})

	recorder.types = nil
	_, err = service.Continue(ctx, "expired", "")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) {
		t.Fatalf("expected expired continue error, got %v", err)
	}
	assertEvents(t, recorder.types, []string{event.AccessConditionChecked, event.RedirectBlocked})

	recorder.types = nil
	_, err = service.Preview(ctx, "expired", "")
	if !errors.Is(err, shortlink.ErrShortLinkExpired) || len(recorder.types) != 0 {
		t.Fatalf("expected event-free expired preview error, got %v events %#v", err, recorder.types)
	}
	_, err = service.Preview(ctx, "direct1", "")
	if !errors.Is(err, shortlink.ErrShortLinkNotInteractive) {
		t.Fatalf("expected direct preview rejection, got %v", err)
	}
	_, err = service.Preview(ctx, "deleted", "")
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected deleted preview to be missing, got %v", err)
	}
	_, err = service.Preview(ctx, "disabled2", "")
	if !errors.Is(err, shortlink.ErrShortLinkDisabled) || len(recorder.types) != 0 {
		t.Fatalf("expected event-free disabled preview error, got %v events %#v", err, recorder.types)
	}
}

// TestRedirectServiceContinueRechecksEveryAccessCondition verifies final redirects cannot bypass lifecycle checks.
func TestRedirectServiceContinueRechecksEveryAccessCondition(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", []string{})
	insertStoredShortLink(t, ctx, pool, user.ID, "disabled3", "https://example.com/disabled", "disabled", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "direct2", "https://example.com/direct", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted3", "https://example.com/deleted", "active", true)

	tests := []struct {
		name   string
		slug   string
		err    error
		events []string
	}{
		{name: "missing", slug: "missing2", err: shortlink.ErrShortLinkMissing, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "disabled", slug: "disabled3", err: shortlink.ErrShortLinkDisabled, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "direct", slug: "direct2", err: shortlink.ErrShortLinkNotInteractive, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
		{name: "deleted", slug: "deleted3", err: shortlink.ErrShortLinkMissing, events: []string{event.AccessConditionChecked, event.RedirectBlocked}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			recorder := &recordingRecorder{}
			service := shortlink.NewRedirectService(pool, recorder)

			_, err := service.Continue(ctx, tt.slug, "")
			if !errors.Is(err, tt.err) {
				t.Fatalf("expected %v, got %v", tt.err, err)
			}
			assertEvents(t, recorder.types, tt.events)
		})
	}
}

type recordingRecorder struct {
	types []string
	ids   []string
}

type notifyingLogWriter struct {
	bytes.Buffer
	once    sync.Once
	written chan struct{}
}

// Write captures a log line and signals the waiting cleanup test.
func (w *notifyingLogWriter) Write(data []byte) (int, error) {
	written, err := w.Buffer.Write(data)
	w.once.Do(func() { close(w.written) })
	return written, err
}

// Record captures redirect events for service assertions.
func (r *recordingRecorder) Record(_ context.Context, item event.Event) error {
	r.types = append(r.types, item.Type)
	r.ids = append(r.ids, item.ShortLinkID)
	return nil
}

// assertEvents verifies an ordered redirect event sequence.
func assertEvents(t *testing.T, actual []string, expected []string) {
	t.Helper()
	if len(actual) != len(expected) {
		t.Fatalf("expected events %#v, got %#v", expected, actual)
	}
	for index := range expected {
		if actual[index] != expected[index] {
			t.Fatalf("expected events %#v, got %#v", expected, actual)
		}
	}
}
