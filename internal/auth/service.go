package auth

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// loginDummyPasswordHash is a fixed valid hash using the current account Argon2id parameters.
var loginDummyPasswordHash = "$argon2id$v=19$" + accountArgonProfile() + "$Br1VkWYfZh4At1JIZgluRg$oo5ZbILTTrshpMQUQxgjSWh7sJJWbxt8i+KrE+Vu2sI"

const (
	defaultLoginOperationTimeout           = 10 * time.Second
	defaultLoginRollbackTimeout            = 2 * time.Second
	defaultLoginConcurrency                = 8
	defaultPasswordVerificationConcurrency = 2
	loginAttemptCleanupBatchSize           = maintenanceCleanupBatchSize
	// LoginFailureThreshold is the database-enforced number of failures that starts a login block.
	LoginFailureThreshold int16 = 10
)

// PasswordVerifier compares a candidate password with an encoded account hash.
type PasswordVerifier func(password string, encodedHash string) bool

type LoginInput struct {
	Username string
	Password string
}

type LoginResult struct {
	User    CurrentUser
	Session Session
}

type Service struct {
	pool                      *pgxpool.Pool
	sessions                  *SessionService
	verifyPassword            PasswordVerifier
	loginSlots                chan struct{}
	passwordVerificationSlots chan struct{}
	sessionIDGenerator        func() (string, error)
	loginOperationTimeout     time.Duration
	loginRollbackTimeout      time.Duration
	deleteStaleLoginAttempts  func(context.Context, int64) (int64, error)
}

// NewService creates an authentication service with database-backed sessions.
func NewService(pool *pgxpool.Pool, sessionTTL time.Duration) *Service {
	return NewServiceWithPasswordVerifier(pool, sessionTTL, VerifyPassword)
}

// NewServiceWithPasswordVerifier creates a service with an instance-scoped verifier for deterministic credential-path tests.
func NewServiceWithPasswordVerifier(pool *pgxpool.Pool, sessionTTL time.Duration, verifier PasswordVerifier) *Service {
	if verifier == nil {
		verifier = VerifyPassword
	}
	service := &Service{
		pool:                      pool,
		sessions:                  NewSessionService(pool, sessionTTL),
		verifyPassword:            verifier,
		loginSlots:                make(chan struct{}, defaultLoginConcurrency),
		passwordVerificationSlots: make(chan struct{}, defaultPasswordVerificationConcurrency),
		sessionIDGenerator:        generateSessionID,
		loginOperationTimeout:     defaultLoginOperationTimeout,
		loginRollbackTimeout:      defaultLoginRollbackTimeout,
	}
	if pool != nil {
		service.deleteStaleLoginAttempts = sqlc.New(pool).DeleteStaleAuthLoginAttempts
	}
	return service
}

// Login verifies credentials and creates a session for an active user.
func (s *Service) Login(ctx context.Context, input LoginInput) (LoginResult, error) {
	username := strings.TrimSpace(input.Username)
	usernameHash := hashLoginUsername(username)
	select {
	case s.loginSlots <- struct{}{}:
		defer func() { <-s.loginSlots }()
	default:
		return LoginResult{}, ErrLoginRateLimited
	}
	operationContext, cancelOperation := context.WithTimeout(context.WithoutCancel(ctx), s.loginOperationTimeout)
	defer cancelOperation()
	tx, err := s.pool.Begin(operationContext)
	if err != nil {
		return LoginResult{}, err
	}
	defer func() {
		rollbackContext, cancelRollback := context.WithTimeout(context.WithoutCancel(ctx), s.loginRollbackTimeout)
		defer cancelRollback()
		_ = tx.Rollback(rollbackContext)
	}()
	queries := sqlc.New(tx)

	attempt, err := lockOrCreateLoginAttempt(operationContext, queries, usernameHash)
	if err != nil {
		return LoginResult{}, err
	}
	if attempt.BlockedUntil.Valid && attempt.BlockedUntil.Time.After(attempt.DatabaseTime.Time) {
		return LoginResult{}, ErrLoginRateLimited
	}

	userRow, err := queries.GetAuthUserByUsername(operationContext, username)
	userFound := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return LoginResult{}, err
	}
	passwordHash := loginDummyPasswordHash
	passwordHashUsable := false
	status := ""
	user := CurrentUser{}
	var permissionsJSON []byte
	if userFound {
		user.ID = userRow.UserID
		user.Username = userRow.Username
		user.Nickname = userRow.Nickname
		user.GroupKey = userRow.GroupKey
		status = userRow.Status
		permissionsJSON = userRow.Permissions
		if userRow.PasswordHash.Valid && isSupportedPasswordHash(userRow.PasswordHash.String) {
			passwordHash = userRow.PasswordHash.String
			passwordHashUsable = true
		}
	}

	select {
	case s.passwordVerificationSlots <- struct{}{}:
	default:
		return LoginResult{}, ErrLoginRateLimited
	}
	passwordMatches := func() bool {
		defer func() { <-s.passwordVerificationSlots }()
		return s.verifyPassword(input.Password, passwordHash)
	}()
	if !userFound || !passwordHashUsable || !passwordMatches {
		failure, recordErr := queries.RecordAuthLoginFailure(operationContext, sqlc.RecordAuthLoginFailureParams{
			UsernameHash:     usernameHash,
			FailureThreshold: LoginFailureThreshold,
		})
		if recordErr != nil {
			return LoginResult{}, recordErr
		}
		if err := tx.Commit(operationContext); err != nil {
			return LoginResult{}, err
		}
		if failure.FailedAttempts >= LoginFailureThreshold && failure.BlockedUntil.Valid {
			return LoginResult{}, ErrLoginRateLimited
		}
		return LoginResult{}, ErrInvalidCredentials
	}
	if err := json.Unmarshal(permissionsJSON, &user.Permissions); err != nil {
		return LoginResult{}, err
	}
	if status != "active" {
		return LoginResult{}, ErrUserDisabled
	}

	sessionID, err := s.sessionIDGenerator()
	if err != nil {
		return LoginResult{}, err
	}
	expiresAt := time.Now().UTC().Add(s.sessions.ttl)
	if _, err := queries.DeleteAuthLoginAttempt(operationContext, usernameHash); err != nil {
		return LoginResult{}, err
	}
	if err := queries.CreateAuthSession(operationContext, sqlc.CreateAuthSessionParams{
		SessionID: sessionID,
		UserID:    user.ID,
		ExpiresAt: pgtype.Timestamptz{Time: expiresAt, Valid: true},
	}); err != nil {
		return LoginResult{}, err
	}
	if err := tx.Commit(operationContext); err != nil {
		return LoginResult{}, err
	}

	return LoginResult{User: user, Session: Session{ID: sessionID, UserID: user.ID, ExpiresAt: expiresAt}}, nil
}

// lockOrCreateLoginAttempt locks an existing attempt before creating and locking a missing row.
func lockOrCreateLoginAttempt(ctx context.Context, queries *sqlc.Queries, usernameHash string) (sqlc.GetAuthLoginAttemptForUpdateRow, error) {
	for {
		attempt, err := queries.GetAuthLoginAttemptForUpdate(ctx, usernameHash)
		if err == nil {
			return attempt, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return sqlc.GetAuthLoginAttemptForUpdateRow{}, err
		}
		if err := queries.EnsureAuthLoginAttempt(ctx, usernameHash); err != nil {
			return sqlc.GetAuthLoginAttemptForUpdateRow{}, err
		}
	}
}

// CleanupStaleLoginAttempts removes one bounded batch of inactive login-failure state.
func (s *Service) CleanupStaleLoginAttempts(ctx context.Context) (int64, error) {
	if s.deleteStaleLoginAttempts == nil {
		return 0, errors.New("auth service database is unavailable")
	}
	return s.deleteStaleLoginAttempts(ctx, loginAttemptCleanupBatchSize)
}

// RunLoginAttemptCleanup removes stale login-failure state immediately and periodically until cancellation.
func (s *Service) RunLoginAttemptCleanup(ctx context.Context, interval time.Duration, logger *slog.Logger) {
	runPeriodicCleanup(ctx, interval, logger, s.CleanupStaleLoginAttempts, "login_attempt_cleanup_failed")
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

// hashLoginUsername returns the base64url SHA-256 digest of a trim-normalized, case-sensitive username.
func hashLoginUsername(username string) string {
	digest := sha256.Sum256([]byte(strings.TrimSpace(username)))
	return base64.RawURLEncoding.EncodeToString(digest[:])
}
