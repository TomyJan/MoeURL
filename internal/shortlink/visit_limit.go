package shortlink

import (
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxVisitLimit = int64(2147483647)

// normalizeVisitLimit requires capability only when a quota change was supplied.
func normalizeVisitLimit(permissions permission.Snapshot, input *VisitLimitInput) (string, pgtype.Int8, error) {
	if input == nil {
		return "keep", pgtype.Int8{}, nil
	}
	if !permissions.Has(permission.ShortLinkSetMaxVisits) {
		return "", pgtype.Int8{}, ErrPermissionDenied
	}
	switch input.Mode {
	case VisitLimitModeUnlimited:
		if input.MaxVisits == nil {
			return input.Mode, pgtype.Int8{}, nil
		}
	case VisitLimitModeLimited:
		if input.MaxVisits != nil && *input.MaxVisits >= 1 && *input.MaxVisits <= maxVisitLimit {
			return input.Mode, pgtype.Int8{Int64: *input.MaxVisits, Valid: true}, nil
		}
	}
	return "", pgtype.Int8{}, ErrInvalidVisitLimit
}
