package system

import "errors"

var (
	ErrAlreadyInitialized       = errors.New("system already initialized")
	ErrInvalidSetupInput        = errors.New("invalid setup input")
	ErrInvalidSetupPolicy       = errors.New("invalid setup policy")
	ErrInvalidSetupToken        = errors.New("invalid setup token")
	ErrSettingsPermissionDenied = errors.New("settings permission denied")
	ErrInvalidSettings          = errors.New("invalid system settings")
	ErrCorruptSettings          = errors.New("corrupt persisted system settings")
	ErrSettingsConflict         = errors.New("system settings conflict")
	ErrNoLoginProvider          = errors.New("no available login provider")
)
