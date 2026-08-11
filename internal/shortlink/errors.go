package shortlink

import (
	"errors"
	"time"
)

var (
	ErrPermissionDenied         = errors.New("permission denied")
	ErrInvalidTargetURL         = errors.New("invalid target url")
	ErrInvalidStatus            = errors.New("invalid status")
	ErrInvalidRedirectMode      = errors.New("invalid redirect mode")
	ErrInvalidIntermediateDelay = errors.New("invalid intermediate delay")
	ErrInvalidExpiration        = errors.New("invalid expiration")
	ErrInvalidPasswordInput     = errors.New("invalid password input")
	ErrPasswordRequired         = errors.New("password required")
	ErrInvalidPassword          = errors.New("invalid password")
	ErrPasswordRateLimited      = errors.New("password rate limited")
	ErrShortLinkMissing         = errors.New("short link missing")
	ErrShortLinkDisabled        = errors.New("short link disabled")
	ErrShortLinkExpired         = errors.New("short link expired")
	ErrShortLinkNotIntermediate = errors.New("short link not intermediate")
	ErrSlugConflict             = errors.New("slug conflict")
	ErrReservedSlug             = errors.New("reserved slug")
	ErrInvalidShortLinkID       = errors.New("invalid short link id")
)

// PasswordRateLimitedError carries the database-authoritative time when retrying is allowed.
type PasswordRateLimitedError struct {
	RetryAt time.Time
}

// Error returns the stable public rate-limit error message.
func (e *PasswordRateLimitedError) Error() string {
	return ErrPasswordRateLimited.Error()
}

// Unwrap preserves errors.Is compatibility with ErrPasswordRateLimited.
func (e *PasswordRateLimitedError) Unwrap() error {
	return ErrPasswordRateLimited
}
