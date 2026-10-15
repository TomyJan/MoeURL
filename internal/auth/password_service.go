package auth

import (
	"context"
	"errors"
	"unicode/utf8"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	// ErrInvalidPasswordInput rejects malformed or unchanged raw password values.
	ErrInvalidPasswordInput = errors.New("invalid password input")
	// ErrPasswordUnavailable identifies accounts without supported local credentials.
	ErrPasswordUnavailable = errors.New("local password unavailable")
)

// PasswordStatus contains only the current account's local credential capability.
type PasswordStatus struct {
	CanChangePassword bool `json:"canChangePassword"`
}

// ChangePasswordInput carries original, unnormalized password values.
type ChangePasswordInput struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

// PasswordStatus resolves the live session independently of local-login admission policy.
func (s *Service) PasswordStatus(ctx context.Context, sessionID string) (PasswordStatus, error) {
	if sessionID == "" {
		return PasswordStatus{}, ErrInvalidSession
	}
	row, err := sqlc.New(s.pool).GetPasswordAccountBySession(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return PasswordStatus{}, ErrInvalidSession
	}
	if err != nil {
		return PasswordStatus{}, err
	}
	return PasswordStatus{CanChangePassword: row.PasswordHash.Valid && isSupportedPasswordHash(row.PasswordHash.String)}, nil
}

// ChangePassword verifies the current password and atomically replaces credentials and revokes all existing sessions.
func (s *Service) ChangePassword(ctx context.Context, sessionID string, input ChangePasswordInput) error {
	if !utf8.ValidString(input.CurrentPassword) || input.CurrentPassword == "" || len(input.CurrentPassword) > 4096 || !utf8.ValidString(input.NewPassword) || utf8.RuneCountInString(input.NewPassword) < 8 || utf8.RuneCountInString(input.NewPassword) > 128 || input.CurrentPassword == input.NewPassword {
		return ErrInvalidPasswordInput
	}
	if sessionID == "" {
		return ErrInvalidSession
	}
	select {
	case s.loginSlots <- struct{}{}:
		defer func() { <-s.loginSlots }()
	default:
		return ErrLoginRateLimited
	}
	operationContext, cancelOperation := context.WithTimeout(context.WithoutCancel(ctx), s.loginOperationTimeout)
	defer cancelOperation()
	account, err := sqlc.New(s.pool).GetPasswordAccountBySession(operationContext, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidSession
	}
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(operationContext)
	if err != nil {
		return err
	}
	defer func() {
		rollbackContext, cancelRollback := context.WithTimeout(context.WithoutCancel(ctx), s.loginRollbackTimeout)
		defer cancelRollback()
		_ = tx.Rollback(rollbackContext)
	}()
	queries := sqlc.New(tx)
	usernameHash := hashLoginUsername(account.Username)
	attempt, err := lockOrCreateLoginAttempt(operationContext, queries, usernameHash)
	if err != nil {
		return err
	}
	if attempt.BlockedUntil.Valid && attempt.BlockedUntil.Time.After(attempt.DatabaseTime.Time) {
		return ErrLoginRateLimited
	}
	passwordHash, err := queries.GetPasswordAccountForUpdate(operationContext, account.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidSession
	}
	if err != nil {
		return err
	}
	if !passwordHash.Valid || !isSupportedPasswordHash(passwordHash.String) {
		return ErrPasswordUnavailable
	}
	// A separate statement after the user lock sees revocations committed by a preceding change.
	if _, err := queries.GetPasswordSessionForUpdate(operationContext, sqlc.GetPasswordSessionForUpdateParams{SessionID: sessionID, UserID: account.UserID}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidSession
		}
		return err
	}
	select {
	case s.passwordVerificationSlots <- struct{}{}:
		defer func() { <-s.passwordVerificationSlots }()
	default:
		return ErrLoginRateLimited
	}
	if !s.verifyPassword(input.CurrentPassword, passwordHash.String) {
		failure, err := queries.RecordAuthLoginFailure(operationContext, sqlc.RecordAuthLoginFailureParams{UsernameHash: usernameHash, FailureThreshold: LoginFailureThreshold})
		if err != nil {
			return err
		}
		if err := tx.Commit(operationContext); err != nil {
			return err
		}
		if failure.FailedAttempts >= LoginFailureThreshold && failure.BlockedUntil.Valid {
			return ErrLoginRateLimited
		}
		return ErrInvalidCredentials
	}
	newHash, err := HashPassword(input.NewPassword)
	if err != nil {
		return err
	}
	if err := queries.UpdateOwnPassword(operationContext, sqlc.UpdateOwnPasswordParams{UserID: account.UserID, PasswordHash: pgtype.Text{String: newHash, Valid: true}}); err != nil {
		return err
	}
	if err := queries.RevokePasswordUserSessions(operationContext, account.UserID); err != nil {
		return err
	}
	if _, err := queries.DeleteAuthLoginAttempt(operationContext, usernameHash); err != nil {
		return err
	}
	return tx.Commit(operationContext)
}
