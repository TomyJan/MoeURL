package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type auditActorKey struct{}

// WithAuditActor carries an explicit actor marker across existing transaction-owning stores.
func WithAuditActor(ctx context.Context, actorID string) context.Context {
	return context.WithValue(ctx, auditActorKey{}, actorID)
}

// SetAuditContext opts an already-open transaction into audit without changing connection defaults.
// An empty actor identifies an explicit system operation; malformed nonempty actors fail closed.
func SetAuditContext(ctx context.Context, tx pgx.Tx, actorID string) error {
	if actorID != "" {
		id, err := uuid.Parse(actorID)
		if err != nil || id == uuid.Nil || id.String() != actorID {
			return errors.New("invalid audit actor")
		}
	}
	_, err := tx.Exec(ctx, `select set_config('moeurl.audit_enabled', 'on', true), set_config('moeurl.audit_actor', $1, true)`, actorID)
	return err
}

// WithAuditTx binds the actor before the first business write and commits audit and business data together.
func WithAuditTx(ctx context.Context, pool *pgxpool.Pool, actorID string, fn func(pgx.Tx) error) error {
	return WithTx(WithAuditActor(ctx, actorID), pool, fn)
}
