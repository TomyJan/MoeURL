package insights

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	pool        *pgxpool.Pool
	permissions permission.Resolver
}

// NewService constructs bounded reads using current database identity and permissions.
func NewService(pool *pgxpool.Pool, permissions permission.Resolver) *Service {
	return &Service{pool, permissions}
}

type snapshot struct {
	queries *sqlc.Queries
	dates   normalizedRange
	now     time.Time
}

// read uses one read-only repeatable-read snapshot for authorization, time and all result queries.
func (s *Service) read(ctx context.Context, user auth.CurrentUser, input RangeInput, required []string, run func(context.Context, snapshot) error) error {
	if err := validateRangeSyntax(input); err != nil {
		return err
	}
	if s.permissions == nil || !validUUID(user.ID) {
		return ErrPermissionDenied
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	queries := sqlc.New(tx)
	actor, err := queries.GetInsightActor(ctx, user.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPermissionDenied
	}
	if err != nil {
		return err
	}
	var resolved permission.Snapshot
	if resolver, ok := s.permissions.(interface {
		ResolveIn(context.Context, sqlc.DBTX, string) (permission.Snapshot, error)
	}); ok {
		resolved, err = resolver.ResolveIn(ctx, tx, actor.GroupKey)
	} else {
		resolved, err = s.permissions.Resolve(ctx, actor.GroupKey)
	}
	if err != nil {
		return err
	}
	stored, err := permission.DecodeSnapshot(actor.Permissions)
	if err != nil {
		return err
	}
	for _, key := range required {
		if !resolved.Has(key) || !stored.Has(key) {
			return ErrPermissionDenied
		}
	}
	now, err := queries.GetInsightTime(ctx)
	if err != nil {
		return err
	}
	dates, err := normalizeRange(input, now.Time)
	if err != nil {
		return err
	}
	if err := run(ctx, snapshot{queries, dates, now.Time.UTC()}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
