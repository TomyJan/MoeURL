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

// NewService implements package-specific behavior.
func NewService(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	return &Service{
		pool:     pool,
		sessions: NewSessionService(pool, sessionTTL),
	}
}

// Login implements package-specific behavior.
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

// Logout implements package-specific behavior.
func (s *Service) Logout(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	return s.sessions.Revoke(ctx, sessionID)
}

// Me implements package-specific behavior.
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

// ResolveCurrentUser implements package-specific behavior.
func (s *Service) ResolveCurrentUser(ctx context.Context, sessionID string) (CurrentUser, error) {
	return s.Me(ctx, sessionID)
}

// findUser implements package-specific behavior.
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

// findUserByID implements package-specific behavior.
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
