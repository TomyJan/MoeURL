package targetpolicy

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// LockTargets must be the first business lock of every target-writing transaction.
// The double-int32 namespace is separate from domain/OIDC single-bigint locks.
func LockTargets(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock_shared($1::integer,$2::integer)`, int32(0x4d4f4555), int32(0x54504f4c))
	return err
}

// LockPolicyUpdate excludes target writers until the policy save commits.
func LockPolicyUpdate(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1::integer,$2::integer)`, int32(0x4d4f4555), int32(0x54504f4c))
	return err
}
