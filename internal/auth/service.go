package auth

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type LoginInput struct {
	Username string
	Password string
}

type LoginResult struct {
	User    CurrentUser
	Session Session
}

type Service struct {
	pool     *pgxpool.Pool
	sessions *SessionService
}

// NewService creates an authentication service with database-backed sessions.
func NewService(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	return &Service{
		pool:     pool,
		sessions: NewSessionService(pool, sessionTTL),
	}
}

// Login verifies credentials and creates a session for an active user.
func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	user, passwordHash, status, err := s.findUser(ctx, input.Username)
	if err != nil {
		return LoginResult{}, err
	}

	if !VerifyPassword(input.Password, passwordHash) {
		return LoginResult{}, ErrInvalidCredentials
	}
	if status != "active" {
		return LoginResult{}, ErrUserDisabled
	}

	session, err := s.sessions.Create(ctx, user.ID)
	if err != nil {
		return LoginResult{}, err
	}

	return LoginResult{User: user, Session: session}, nil
}

// Logout revokes a non-empty session identifier.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	return s.sessions.Revoke(ctx, sessionID)
}

// Me resolves an active session user or returns the guest identity.
func (s *Service) Me(ctx context.Context, sessionID string) (CurrentUser, error) {
	if sessionID == "" {
		return GuestUser(), nil
	}
	session, err := s.sessions.Resolve(ctx, sessionID)
	if err != nil {
		return GuestUser(), err
	}
	user, _, status, err := s.findUserByID(ctx, session.UserID)
	if err != nil {
		return GuestUser(), err
	}
	if status != "active" {
		return GuestUser(), ErrUserDisabled
	}
	return user, nil
}

// ResolveCurrentUser satisfies current-user resolution through Me.
func (s *Service) ResolveCurrentUser(ctx context.Context, sessionID string) (CurrentUser, error) {
	return s.Me(ctx, sessionID)
}

// findUser loads a login user, password hash, and status by username.
func (s *Service) findUser(ctx context.Context, username string) (CurrentUser, string, string, error) {
	var user CurrentUser
	var passwordHash *string
	var permissionsJSON []byte
	var status string
	err := s.pool.QueryRow(ctx, `
		select app_user.id::text,
			app_user.username,
			app_user.nickname,
			app_user.password_hash,
			app_user.status,
			user_group.key,
			user_group.permissions
		from app_user
		join user_group on user_group.id = app_user.group_id
		where app_user.username = $1 and app_user.deleted_at is null
	`, username).Scan(&user.ID, &user.Username, &user.Nickname, &passwordHash, &status, &user.GroupKey, &permissionsJSON)
	if err == pgx.ErrNoRows {
		return CurrentUser{}, "", "", ErrInvalidCredentials
	}
	if err != nil {
		return CurrentUser{}, "", "", err
	}
	if passwordHash == nil {
		return CurrentUser{}, "", "", ErrInvalidCredentials
	}
	if err := json.Unmarshal(permissionsJSON, &user.Permissions); err != nil {
		return CurrentUser{}, "", "", err
	}

	return user, *passwordHash, status, nil
}

// findUserByID loads a user, optional password hash, and status by identifier.
func (s *Service) findUserByID(ctx context.Context, userID string) (CurrentUser, string, string, error) {
	var user CurrentUser
	var passwordHash *string
	var permissionsJSON []byte
	var status string
	err := s.pool.QueryRow(ctx, `
		select app_user.id::text,
			app_user.username,
			app_user.nickname,
			app_user.password_hash,
			app_user.status,
			user_group.key,
			user_group.permissions
		from app_user
		join user_group on user_group.id = app_user.group_id
		where app_user.id = $1 and app_user.deleted_at is null
	`, userID).Scan(&user.ID, &user.Username, &user.Nickname, &passwordHash, &status, &user.GroupKey, &permissionsJSON)
	if err == pgx.ErrNoRows {
		return CurrentUser{}, "", "", ErrInvalidCredentials
	}
	if err != nil {
		return CurrentUser{}, "", "", err
	}
	if err := json.Unmarshal(permissionsJSON, &user.Permissions); err != nil {
		return CurrentUser{}, "", "", err
	}
	password := ""
	if passwordHash != nil {
		password = *passwordHash
	}
	return user, password, status, nil
}
