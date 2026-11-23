package usergroup

import "errors"

var (
	// ErrPermissionDenied indicates that the actor lacks administrative access.
	ErrPermissionDenied = errors.New("user group permission denied")
	// ErrInvalidInput indicates malformed or unsupported update input.
	ErrInvalidInput = errors.New("invalid user group input")
	// ErrUserGroupNotFound indicates that the requested built-in group does not exist.
	ErrUserGroupNotFound = errors.New("user group not found")
	// ErrUserGroupNameConflict indicates that a normalized group name is already in use.
	ErrUserGroupNameConflict = errors.New("user group name already exists")
	// ErrUserGroupHasMembers indicates a custom group still has account references.
	ErrUserGroupHasMembers = errors.New("user group still has members")
	// ErrProtectedGroup indicates that an immutable built-in group was targeted by custom CRUD.
	ErrProtectedGroup = errors.New("built-in user group is protected")
	// ErrPermissionConflict indicates an optimistic concurrency conflict.
	ErrPermissionConflict = errors.New("user group permission conflict")
	// ErrProtectedPermission indicates an attempted protected ownership change.
	ErrProtectedPermission = errors.New("protected user group permission")
	// ErrPermissionResolverNeeded indicates missing database-backed permission resolution.
	ErrPermissionResolverNeeded = errors.New("user group permission resolver is required")
)
