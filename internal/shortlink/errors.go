package shortlink

import "errors"

var (
	ErrPermissionDenied         = errors.New("permission denied")
	ErrInvalidTargetURL         = errors.New("invalid target url")
	ErrInvalidStatus            = errors.New("invalid status")
	ErrInvalidRedirectMode      = errors.New("invalid redirect mode")
	ErrInvalidIntermediateDelay = errors.New("invalid intermediate delay")
	ErrInvalidExpiration        = errors.New("invalid expiration")
	ErrShortLinkMissing         = errors.New("short link missing")
	ErrShortLinkDisabled        = errors.New("short link disabled")
	ErrSlugConflict             = errors.New("slug conflict")
	ErrReservedSlug             = errors.New("reserved slug")
	ErrInvalidShortLinkID       = errors.New("invalid short link id")
)
