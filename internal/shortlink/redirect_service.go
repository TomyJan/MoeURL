package shortlink

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/event"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	passwordFailureWindow             = 15 * time.Minute
	passwordBlockDuration             = 15 * time.Minute
	accessGrantTTL                    = 15 * time.Minute
	accessGrantCleanupBatchSize int64 = 500
	accessTokenBytes                  = 32
	maxPasswordFailures               = int16(5)
)

var accessTokenRandomReader io.Reader = rand.Reader

// RedirectResult contains the resolved redirect target and source short link.
type RedirectResult struct {
	TargetURL   string
	ShortLinkID string
}

// OpenResult contains the decision for an initial public short-link request.
type OpenResult struct {
	RedirectResult
	RedirectMode     string
	Slug             string
	RequiresPassword bool
}

// PreviewResult contains the minimal public data required by an intermediate page.
type PreviewResult struct {
	Slug                     string     `json:"slug"`
	TargetHost               string     `json:"targetHost"`
	RedirectMode             string     `json:"redirectMode"`
	IntermediateDelaySeconds int16      `json:"intermediateDelaySeconds"`
	ExpiresAt                *time.Time `json:"expiresAt"`
	RequiresPassword         bool       `json:"requiresPassword"`
}

// RedirectService resolves public short-link access actions.
type RedirectService struct {
	queries  *sqlc.Queries
	pool     *pgxpool.Pool
	recorder event.Recorder
}

// NewRedirectService creates a redirect service backed by PostgreSQL.
func NewRedirectService(pool *pgxpool.Pool, recorder event.Recorder) *RedirectService {
	if recorder == nil {
		recorder = event.NoopRecorder{}
	}
	return &RedirectService{
		queries:  sqlc.New(pool),
		pool:     pool,
		recorder: recorder,
	}
}

// Open resolves the initial public request to either a target or an intermediate page.
func (s *RedirectService) Open(ctx context.Context, slug string) (OpenResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.recordBlocked(ctx, slug, "")
		return OpenResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return OpenResult{}, err
	}

	shortLinkID := uuidFromPgtype(link.ID)
	s.record(ctx, event.ShortLinkOpened, slug, shortLinkID)
	if err := s.checkAccess(ctx, slug, shortLinkID, link.Status, link.Expired, link.RedirectMode, false); err != nil {
		return OpenResult{}, err
	}

	result := OpenResult{
		RedirectResult:   RedirectResult{ShortLinkID: shortLinkID},
		RedirectMode:     link.RedirectMode,
		Slug:             slug,
		RequiresPassword: link.PasswordHash.Valid,
	}
	if result.RequiresPassword {
		return result, nil
	}
	if link.RedirectMode == RedirectModeIntermediate {
		return result, nil
	}

	s.record(ctx, event.RedirectInitiated, slug, shortLinkID)
	result.TargetURL = link.TargetUrl
	return result, nil
}

// Preview returns event-free, non-sensitive data for an intermediate page.
func (s *RedirectService) Preview(ctx context.Context, slug string, accessToken string) (PreviewResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return PreviewResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return PreviewResult{}, err
	}
	passwordEnabled := link.PasswordHash.Valid
	if err := validateAccessConditions(link.Status, link.Expired, link.RedirectMode, !passwordEnabled); err != nil {
		return PreviewResult{}, err
	}
	requiresPassword := passwordEnabled
	if passwordEnabled {
		valid, err := s.hasValidAccessGrant(ctx, link.ID, accessToken)
		if err != nil {
			return PreviewResult{}, err
		}
		requiresPassword = !valid
	}

	target, err := url.Parse(link.TargetUrl)
	if err != nil {
		return PreviewResult{}, fmt.Errorf("parse stored target URL: %w", err)
	}
	if target.Hostname() == "" {
		return PreviewResult{}, errors.New("stored target URL has no hostname")
	}

	return PreviewResult{
		Slug:                     slug,
		TargetHost:               target.Hostname(),
		RedirectMode:             link.RedirectMode,
		IntermediateDelaySeconds: link.IntermediateDelaySeconds,
		ExpiresAt:                optionalTime(link.ExpiresAt.Valid, link.ExpiresAt.Time),
		RequiresPassword:         requiresPassword,
	}, nil
}

// Continue resolves the final target after rechecking all access conditions.
func (s *RedirectService) Continue(ctx context.Context, slug string, accessToken string) (RedirectResult, error) {
	slug = strings.ToLower(slug)
	link, err := s.queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		s.recordBlocked(ctx, slug, "")
		return RedirectResult{}, ErrShortLinkMissing
	}
	if err != nil {
		return RedirectResult{}, err
	}

	shortLinkID := uuidFromPgtype(link.ID)
	passwordEnabled := link.PasswordHash.Valid
	if err := s.checkAccess(ctx, slug, shortLinkID, link.Status, link.Expired, link.RedirectMode, !passwordEnabled); err != nil {
		return RedirectResult{}, err
	}
	if passwordEnabled {
		if accessToken == "" {
			s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
			return RedirectResult{}, ErrPasswordRequired
		}
		valid, err := s.hasValidAccessGrant(ctx, link.ID, accessToken)
		if err != nil {
			return RedirectResult{}, err
		}
		if !valid {
			s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
			return RedirectResult{}, ErrPasswordRequired
		}
	}

	s.record(ctx, event.RedirectInitiated, slug, shortLinkID)
	return RedirectResult{TargetURL: link.TargetUrl, ShortLinkID: shortLinkID}, nil
}

// hasValidAccessGrant verifies a scoped token against the current password revision.
func (s *RedirectService) hasValidAccessGrant(ctx context.Context, shortLinkID pgtype.UUID, accessToken string) (bool, error) {
	if accessToken == "" {
		return false, nil
	}
	_, err := s.queries.GetValidShortLinkAccessGrant(ctx, sqlc.GetValidShortLinkAccessGrantParams{
		ShortLinkID: shortLinkID,
		TokenHash:   hashAccessToken(accessToken),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Unlock validates a password and returns a short-lived access grant.
func (s *RedirectService) Unlock(ctx context.Context, slug string, password string) (AccessGrant, error) {
	if s.pool == nil {
		return AccessGrant{}, errors.New("redirect service database is unavailable")
	}
	slug = strings.ToLower(strings.TrimSpace(slug))
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return AccessGrant{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	queries := sqlc.New(tx)
	state, err := queries.GetShortLinkPasswordStateBySlugForUpdate(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccessGrant{}, ErrShortLinkMissing
	}
	if err != nil {
		return AccessGrant{}, err
	}
	// Re-read the link after acquiring the row lock so all access checks use its latest state.
	link, err := queries.GetShortLinkBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return AccessGrant{}, ErrShortLinkMissing
	}
	if err != nil {
		return AccessGrant{}, err
	}
	if err := validateAccessConditions(link.Status, link.Expired, link.RedirectMode, false); err != nil {
		return AccessGrant{}, err
	}
	if !state.PasswordHash.Valid {
		return AccessGrant{}, ErrInvalidPassword
	}
	if password == "" {
		return AccessGrant{}, ErrPasswordRequired
	}
	nowValue, err := queries.GetDatabaseTime(ctx)
	if err != nil {
		return AccessGrant{}, err
	}
	now := nowValue.Time
	if state.PasswordBlockedUntil.Valid && now.Before(state.PasswordBlockedUntil.Time) {
		return AccessGrant{}, ErrPasswordRateLimited
	}
	passwordMatches := false
	if _, _, err := validatePasswordInput(&PasswordInput{Mode: PasswordModeSet, Value: password}); err == nil {
		passwordMatches = auth.VerifyPassword(password, state.PasswordHash.String)
	}
	if !passwordMatches {
		failure := nextPasswordFailure(now, state.PasswordFailedAttempts, state.PasswordWindowStartedAt)
		if err := queries.RecordShortLinkPasswordFailure(ctx, sqlc.RecordShortLinkPasswordFailureParams{
			ID:                      link.ID,
			PasswordFailedAttempts:  failure.attempts,
			PasswordWindowStartedAt: failure.windowStartedAt,
			PasswordBlockedUntil:    failure.blockedUntil,
		}); err != nil {
			return AccessGrant{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return AccessGrant{}, err
		}
		if failure.blockedUntil.Valid {
			return AccessGrant{}, ErrPasswordRateLimited
		}
		return AccessGrant{}, ErrInvalidPassword
	}
	if err := queries.ResetShortLinkPasswordFailures(ctx, link.ID); err != nil {
		return AccessGrant{}, err
	}
	token, tokenHash, err := generateAccessToken()
	if err != nil {
		return AccessGrant{}, err
	}
	expiresAt := now.Add(accessGrantTTL)
	if _, err := queries.CreateShortLinkAccessGrant(ctx, sqlc.CreateShortLinkAccessGrantParams{
		ID:          uuidToPgtype(uuid.New()),
		ShortLinkID: link.ID,
		TokenHash:   tokenHash,
		ExpiresAt:   pgtype.Timestamptz{Time: expiresAt, Valid: true},
	}); err != nil {
		return AccessGrant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AccessGrant{}, err
	}
	return AccessGrant{Token: token, ExpiresAt: expiresAt}, nil
}

// CleanupExpiredAccessGrants drains expired access grants in bounded batches.
func (s *RedirectService) CleanupExpiredAccessGrants(ctx context.Context, loggers ...*slog.Logger) error {
	if s.pool == nil {
		return errors.New("redirect service database is unavailable")
	}
	startedAt := time.Now()
	var deletedRows int64
	batchCount := 0
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		deleted, err := s.queries.DeleteExpiredShortLinkAccessGrants(ctx, accessGrantCleanupBatchSize)
		if err != nil {
			return err
		}
		deletedRows += deleted
		batchCount++
		if deleted < accessGrantCleanupBatchSize {
			if len(loggers) > 0 && loggers[0] != nil && deletedRows > accessGrantCleanupBatchSize {
				loggers[0].InfoContext(
					ctx,
					"access_grant_cleanup_completed",
					"deleted_rows", deletedRows,
					"batch_count", batchCount,
					"duration_ms", time.Since(startedAt).Milliseconds(),
					"index", "short_link_access_grant_expiry_idx",
				)
			}
			return nil
		}
	}
}

// RunAccessGrantCleanup removes expired grants periodically until the context is canceled.
func (s *RedirectService) RunAccessGrantCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	if interval <= 0 {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.CleanupExpiredAccessGrants(ctx, logger); err != nil {
				logger.ErrorContext(ctx, "access_grant_cleanup_failed", "error", err)
			}
		}
	}
}

// checkAccess records access-condition auditing around the shared validation rules.
func (s *RedirectService) checkAccess(ctx context.Context, slug string, shortLinkID string, status string, expired bool, redirectMode string, requireIntermediate bool) error {
	s.record(ctx, event.AccessConditionChecked, slug, shortLinkID)
	if err := validateAccessConditions(status, expired, redirectMode, requireIntermediate); err != nil {
		s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
		return err
	}
	return nil
}

// validateAccessConditions enforces enabled, unexpired, and redirect-mode requirements.
func validateAccessConditions(status string, expired bool, redirectMode string, requireIntermediate bool) error {
	if status != shortLinkStatusActive {
		return ErrShortLinkDisabled
	}
	if expired {
		return ErrShortLinkExpired
	}
	if requireIntermediate && redirectMode != RedirectModeIntermediate {
		return ErrShortLinkNotIntermediate
	}
	return nil
}

// recordBlocked records a best-effort non-statistical blocked-access audit event.
func (s *RedirectService) recordBlocked(ctx context.Context, slug string, shortLinkID string) {
	s.record(ctx, event.AccessConditionChecked, slug, shortLinkID)
	s.record(ctx, event.RedirectBlocked, slug, shortLinkID)
}

// optionalTime converts a nullable database timestamp into the public pointer form.
func optionalTime(valid bool, value time.Time) *time.Time {
	if !valid {
		return nil
	}
	return &value
}

type passwordFailureUpdate struct {
	attempts        int16
	windowStartedAt pgtype.Timestamptz
	blockedUntil    pgtype.Timestamptz
}

// nextPasswordFailure advances the fixed failure window and applies the lockout threshold.
func nextPasswordFailure(now time.Time, attempts int16, windowStartedAt pgtype.Timestamptz) passwordFailureUpdate {
	if !windowStartedAt.Valid || !now.Before(windowStartedAt.Time.Add(passwordFailureWindow)) {
		return passwordFailureUpdate{
			attempts:        1,
			windowStartedAt: pgtype.Timestamptz{Time: now, Valid: true},
		}
	}

	attempts++
	update := passwordFailureUpdate{attempts: attempts, windowStartedAt: windowStartedAt}
	if attempts >= maxPasswordFailures {
		update.blockedUntil = pgtype.Timestamptz{Time: now.Add(passwordBlockDuration), Valid: true}
	}
	return update
}

// generateAccessToken returns a random bearer token and the hash persisted for verification.
func generateAccessToken() (string, string, error) {
	random := make([]byte, accessTokenBytes)
	if _, err := io.ReadFull(accessTokenRandomReader, random); err != nil {
		return "", "", err
	}
	token := base64.RawURLEncoding.EncodeToString(random)
	return token, hashAccessToken(token), nil
}

// hashAccessToken derives the non-reversible representation stored for an access grant.
func hashAccessToken(token string) string {
	hash := sha256.Sum256([]byte(token))
	return base64.RawURLEncoding.EncodeToString(hash[:])
}

// record submits a best-effort redirect event without affecting resolution.
func (s *RedirectService) record(ctx context.Context, eventType string, slug string, shortLinkID string) {
	_ = s.recorder.Record(ctx, event.Event{Type: eventType, Slug: slug, ShortLinkID: shortLinkID})
}
