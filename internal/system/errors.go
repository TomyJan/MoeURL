package system

import "errors"

var (
	ErrAlreadyInitialized = errors.New("system already initialized")
	ErrInvalidSetupInput  = errors.New("invalid setup input")
)
