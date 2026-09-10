package auth

import "errors"

var (
	// ErrInvalidCredentials hides whether the username or password was incorrect.
	ErrInvalidCredentials = errors.New("invalid credentials")
	// ErrUserDisabled indicates valid credentials belong to a disabled account.
	ErrUserDisabled = errors.New("user disabled")
	// ErrLoginRateLimited indicates the normalized username is temporarily blocked.
	ErrLoginRateLimited = errors.New("login rate limited")
)
