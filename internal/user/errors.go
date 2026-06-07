package user

import "errors"

var (
	ErrPermissionDenied = errors.New("permission denied")
	ErrUsernameExists   = errors.New("username exists")
	ErrInvalidInput     = errors.New("invalid input")
)
