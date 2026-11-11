package shortlink

import (
	"context"
	"errors"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// checkNewTargets preserves the public invalid-URL error for ambiguous hosts.
func checkNewTargets(ctx context.Context, q *sqlc.Queries, targets []string) error {
	err := targetpolicy.CheckTargets(ctx, q, targets)
	if errors.Is(err, targetpolicy.ErrInvalidTarget) {
		return ErrInvalidTargetURL
	}
	return err
}

// lockTargetWriter rechecks current actor and group after the gate wait. The
// shared identity locks prevent completed revocations from using a stale role.
func lockTargetWriter(ctx context.Context, q *sqlc.Queries, actor auth.CurrentUser, admin bool, required ...string) (string, error) {
	id, err := uuid.Parse(actor.ID)
	if err != nil || id == uuid.Nil || id.String() != actor.ID {
		return "", ErrPermissionDenied
	}
	groupID, err := q.LockTargetPolicyActor(ctx, uuidToPgtype(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrPermissionDenied
	}
	if err != nil {
		return "", err
	}
	group, err := q.LockTargetWriterGroup(ctx, groupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrPermissionDenied
	}
	if err != nil {
		return "", err
	}
	grants, err := permission.DecodeSnapshot(group.Permissions)
	if err != nil {
		return "", err
	}
	if admin && (group.Key != "admin" || !grants.Has(permission.AdminAccess)) {
		return "", ErrPermissionDenied
	}
	for _, key := range required {
		if key != "" && !grants.Has(key) {
			return "", ErrPermissionDenied
		}
	}
	return group.Key, nil
}

// targetWriteCapabilities rechecks only features actually present in this command,
// avoiding both stale grants after waiting and rejection for unrelated revocation.
func targetWriteCapabilities(mode string, delay, expiry, password, limit, metadata bool) []string {
	keys := []string{redirectModePermission(mode)}
	for _, item := range []struct {
		present bool
		key     string
	}{
		{delay, permission.ShortLinkUseIntermediate}, {expiry, permission.ShortLinkSetExpiration},
		{password, permission.ShortLinkSetPassword}, {limit, permission.ShortLinkSetMaxVisits},
		{metadata, permission.ShortLinkSetMetadata},
	} {
		if item.present {
			keys = append(keys, item.key)
		}
	}
	return keys
}
