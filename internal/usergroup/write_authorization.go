package usergroup

import (
	"bytes"
	"context"
	"errors"
	"regexp"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var groupRevisionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)

// groupWriterStore locks current identity and its administrator group in the write transaction.
type groupWriterStore interface {
	LockDomainPreferenceUser(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceUserRow, error)
	LockGroupDefaultAdmin(context.Context, pgtype.UUID) (sqlc.UserGroup, error)
}

// groupWriterID rejects ambiguous identities before opening an audited write transaction.
func groupWriterID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

// authorizeGroupWriter rechecks locked database identity after the shared domain prefix.
// The admin row is locked exclusively first so later target writes never upgrade a share lock.
func authorizeGroupWriter(ctx context.Context, q groupWriterStore, actorID pgtype.UUID, requireDomainManage bool) (sqlc.UserGroup, error) {
	actor, err := q.LockDomainPreferenceUser(ctx, actorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.UserGroup{}, ErrPermissionDenied
	}
	if err != nil {
		return sqlc.UserGroup{}, err
	}
	admin, err := q.LockGroupDefaultAdmin(ctx, actor.GroupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.UserGroup{}, ErrPermissionDenied
	}
	if err != nil {
		return sqlc.UserGroup{}, err
	}
	grants, err := decodeGroupConfigurationPermissions(admin.Permissions)
	if err != nil {
		return sqlc.UserGroup{}, err
	}
	if !grants.Has(permission.AdminAccess) || (requireDomainManage && !grants.Has(permission.DomainManage)) {
		return sqlc.UserGroup{}, ErrPermissionDenied
	}
	return admin, nil
}

// decodeGroupConfigurationPermissions distinguishes a corrupt non-array from a deliberately empty grant list.
func decodeGroupConfigurationPermissions(data []byte) (permission.Snapshot, error) {
	value := bytes.TrimSpace(data)
	if len(value) == 0 || value[0] != '[' {
		return permission.Snapshot{}, errors.New("invalid stored group permission array")
	}
	return permission.DecodeSnapshot(data)
}
