package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"io"
	"time"

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
	pool *pgxpool.Pool
	ttl  time.Duration
}

func NewSessionService(pool *pgxpool.Pool, ttl time.Duration) *SessionService {
	return &SessionService{pool: pool, ttl: ttl}
}

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

func generateSessionID() (string, error) {
	token := make([]byte, 32)
	if _, err := io.ReadFull(sessionRandomReader, token); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(token), nil
}

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

func (s *SessionService) Revoke(ctx context.Context, sessionID string) error {
	_, err := s.pool.Exec(ctx, `update session set revoked_at = now() where id = $1`, sessionID)
	return err
}
