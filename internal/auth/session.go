package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"log/slog"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const SessionCookieName = "moeurl_session"

var ErrInvalidSession = errors.New("invalid session")

var sessionRandomReader io.Reader = rand.Reader

type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
}

type SessionService struct {
	pool            *pgxpool.Pool
	ttl             time.Duration
	cleanupSessions func(context.Context) (int64, error)
}

// NewSessionService creates a session service with the supplied lifetime.
func NewSessionService(pool *pgxpool.Pool, ttl time.Duration) *SessionService {
	return &SessionService{pool: pool, ttl: ttl, cleanupSessions: sessionCleanupForPool(pool)}
}

// Create persists a new session for a user and returns its token and expiry.
func (s *SessionService) Create(ctx context.Context, userID string) (Session, error) {
	sessionID, err := generateSessionID()
	if err != nil {
		return Session{}, err
	}
	expiresAt := time.Now().UTC().Add(s.ttl)
	_, err = s.pool.Exec(ctx, `
		insert into session (id, user_id, expires_at, last_seen_at, created_at)
		values ($1, $2, $3, now(), now())
	`, sessionID, userID, expiresAt)
	if err != nil {
		return Session{}, err
	}
	return Session{ID: sessionID, UserID: userID, ExpiresAt: expiresAt}, nil
}

// generateSessionID creates a cryptographically random session token.
func generateSessionID() (string, error) {
	token := make([]byte, 32)
	if _, err := io.ReadFull(sessionRandomReader, token); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(token), nil
}

// Resolve returns a valid session and updates its last-seen timestamp.
func (s *SessionService) Resolve(ctx context.Context, sessionID string) (Session, error) {
	var session Session
	var revokedAt *time.Time
	err := s.pool.QueryRow(ctx, `
		select id::text, user_id::text, expires_at, revoked_at
		from session
		where id = $1
	`, sessionID).Scan(&session.ID, &session.UserID, &session.ExpiresAt, &revokedAt)
	if err == pgx.ErrNoRows {
		return Session{}, ErrInvalidSession
	}
	if err != nil {
		return Session{}, err
	}
	if revokedAt != nil || !session.ExpiresAt.After(time.Now().UTC()) {
		return Session{}, ErrInvalidSession
	}
	_, err = s.pool.Exec(ctx, `update session set last_seen_at = now() where id = $1`, sessionID)
	if err != nil {
		return Session{}, err
	}

	return session, nil
}

// Revoke marks a session as revoked.
func (s *SessionService) Revoke(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx, `update session set revoked_at = now() where id = $1`, sessionID)
	return err
}

// CleanupSessions removes one bounded batch of expired or revoked sessions.
func (s *SessionService) CleanupSessions(ctx context.Context) error {
	if s.cleanupSessions == nil {
		return errors.New("session service database is unavailable")
	}
	_, err := s.cleanupSessions(ctx)
	return err
}

// RunCleanup removes expired or revoked sessions immediately and periodically until cancellation.
func (s *SessionService) RunCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	runPeriodicCleanup(ctx, interval, logger, s.CleanupSessions, "session_cleanup_failed", "task", "session_cleanup")
}

// runPeriodicCleanup executes maintenance immediately and on each interval until cancellation.
func runPeriodicCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger, cleanup func(context.Context) error, failureEvent string, attributes ...any) {
	if interval <= 0 {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	if ctx.Err() != nil {
		return
	}
	runOnce := func() bool {
		if err := cleanup(ctx); err != nil {
			if ctx.Err() != nil && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
				return false
			}
			logger.ErrorContext(ctx, failureEvent, append(attributes, "error", err)...)
		}
		return true
	}
	if !runOnce() {
		return
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !runOnce() {
				return
			}
		}
	}
}

// sessionCleanupForPool builds the generated cleanup operation when a database is available.
func sessionCleanupForPool(pool *pgxpool.Pool) func(context.Context) (int64, error) {
	if pool == nil {
		return nil
	}
	return sqlc.New(pool).CleanupSessions
}
