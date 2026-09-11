package oidc

import "errors"

var (
	ErrInvalidInput         = errors.New("invalid OIDC input")
	ErrPermissionDenied     = errors.New("OIDC permission denied")
	ErrProviderNotFound     = errors.New("OIDC provider not found")
	ErrProviderConflict     = errors.New("OIDC provider conflict")
	ErrProviderKeyExists    = errors.New("OIDC provider key exists")
	ErrRuntimeUnavailable   = errors.New("OIDC runtime unavailable")
	ErrDiscoveryUnavailable = errors.New("OIDC discovery unavailable")
	ErrLoginFailed          = errors.New("OIDC login failed")
	ErrIdentityNotAllowed   = errors.New("OIDC identity not allowed")
	ErrUserDisabled         = errors.New("OIDC user disabled")
)
