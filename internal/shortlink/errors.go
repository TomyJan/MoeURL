package shortlink

import "errors"

var (
	ErrPermissionDenied  = errors.New("permission denied")
	ErrInvalidTargetURL  = errors.New("invalid target url")
	ErrInvalidStatus     = errors.New("invalid status")
	ErrShortLinkMissing  = errors.New("short link missing")
	ErrShortLinkDisabled = errors.New("short link disabled")
	ErrSlugConflict      = errors.New("slug conflict")
	ErrReservedSlug      = errors.New("reserved slug")
)
