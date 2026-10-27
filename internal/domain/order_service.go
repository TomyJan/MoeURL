package domain

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

var domainOrderVersionPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$`)

// SetOrderInput changes only one domain's priority against its full saved revision.
type SetOrderInput struct {
	ID                string
	SortOrder         int32
	ExpectedUpdatedAt string
}

// domainOrderStore keeps reauthorization and the single-field write in one transaction.
type domainOrderStore interface {
	LockDomainOrderActor(context.Context, pgtype.UUID) (sqlc.LockDomainOrderActorRow, error)
	LockDomainOrderGroup(context.Context, pgtype.UUID) ([]byte, error)
	GetManagedDomainForUpdate(context.Context, pgtype.UUID) (sqlc.Domain, error)
	ListDomainGrantKeys(context.Context, pgtype.UUID) ([]string, error)
	DomainHasReferences(context.Context, pgtype.UUID) (bool, error)
	SetDomainSortOrder(context.Context, sqlc.SetDomainSortOrderParams) (sqlc.Domain, error)
}

// SetOrder serializes a bounded, reauthorized priority change with all domain writes.
func (s *Service) SetOrder(ctx context.Context, actor auth.CurrentUser, input SetOrderInput) (Domain, error) {
	actorID, err := uuid.Parse(actor.ID)
	if err != nil || actorID == uuid.Nil || actorID.String() != actor.ID {
		return Domain{}, ErrPermissionDenied
	}
	id, expected, err := validateSetOrderInput(input)
	if err != nil {
		return Domain{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result Domain
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		var updateErr error
		result, updateErr = applyDomainOrder(ctx, s.queries.WithTx(tx), pgUUID(actorID), pgUUID(id), expected, input.SortOrder)
		return updateErr
	})
	if err != nil {
		return Domain{}, err
	}
	return result, nil
}

// validateSetOrderInput rejects ambiguous identities, out-of-range orders and incomplete revisions.
func validateSetOrderInput(input SetOrderInput) (uuid.UUID, time.Time, error) {
	id, err := uuid.Parse(input.ID)
	if err != nil || id == uuid.Nil || id.String() != input.ID || input.SortOrder < -10000 || input.SortOrder > 10000 || !domainOrderVersionPattern.MatchString(input.ExpectedUpdatedAt) {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	expected, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || expected.IsZero() {
		return uuid.Nil, time.Time{}, ErrInvalidInput
	}
	return id, expected, nil
}

// applyDomainOrder checks current identity before the target and never audits a no-op.
func applyDomainOrder(ctx context.Context, q domainOrderStore, actorID, domainID pgtype.UUID, expected time.Time, order int32) (Domain, error) {
	actor, err := q.LockDomainOrderActor(ctx, actorID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Domain{}, ErrPermissionDenied
	}
	if err != nil {
		return Domain{}, err
	}
	permissions, err := q.LockDomainOrderGroup(ctx, actor.GroupID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Domain{}, ErrPermissionDenied
	}
	if err != nil {
		return Domain{}, err
	}
	grants, err := permission.DecodeSnapshot(permissions)
	if err != nil {
		return Domain{}, err
	}
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.DomainManage) {
		return Domain{}, ErrPermissionDenied
	}
	current, err := q.GetManagedDomainForUpdate(ctx, domainID)
	if err != nil {
		return Domain{}, mapNotFound(err)
	}
	if !current.UpdatedAt.Time.Equal(expected) {
		return Domain{}, ErrVersionConflict
	}
	groups, err := q.ListDomainGrantKeys(ctx, current.ID)
	if err != nil {
		return Domain{}, err
	}
	referenced, err := q.DomainHasReferences(ctx, current.ID)
	if err != nil {
		return Domain{}, err
	}
	if current.SortOrder != order {
		current, err = q.SetDomainSortOrder(ctx, sqlc.SetDomainSortOrderParams{ID: current.ID, SortOrder: order, UpdatedAt: current.UpdatedAt})
		if errors.Is(err, pgx.ErrNoRows) {
			return Domain{}, ErrVersionConflict
		}
		if err != nil {
			return Domain{}, err
		}
	}
	return domainFromRow(current, groups, referenced), nil
}
