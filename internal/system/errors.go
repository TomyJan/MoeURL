package system

import "errors"

var (
	ErrAlreadyInitialized = errors.New("system already initialized")
	ErrInvalidSetupInput  = errors.New("invalid setup input")
	ErrInvalidSetupPolicy = errors.New("invalid setup policy")
	ErrInvalidSetupToken  = errors.New("invalid setup token")
)
