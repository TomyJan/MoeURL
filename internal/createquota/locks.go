package createquota

import (
	"context"

	"github.com/jackc/pgx/v5"
)

// LockCreation follows the target gate and precedes domain and identity locks.
// The same transaction must retain it through creation, audit and receipt.
func LockCreation(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock_shared($1::integer,$2::integer)`, int32(0x4d4f4555), int32(0x4351554f))
	return err
}

// lockUpdate excludes creation before a policy writer takes identity locks.
func lockUpdate(ctx context.Context, tx pgx.Tx) error {
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock($1::integer,$2::integer)`, int32(0x4d4f4555), int32(0x4351554f))
	return err
}
