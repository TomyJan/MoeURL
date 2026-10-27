package user

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DomainPreference stores a nullable creation-panel default and its independent revision.
type DomainPreference struct {
	DomainID  *string `json:"domainId"`
	UpdatedAt *string `json:"updatedAt"`
}

// DomainPreferenceResult never includes metadata from a domain whose grants may have changed.
type DomainPreferenceResult struct {
	Preference DomainPreference `json:"preference"`
}

// UpdateDomainPreferenceInput replaces only this account's domain selection.
type UpdateDomainPreferenceInput struct {
	DomainID          *string
	ExpectedUpdatedAt *string
}

type domainPreferenceStore interface {
	GetUserDomainPreference(context.Context, pgtype.UUID) (sqlc.GetUserDomainPreferenceRow, error)
	LockDomainPreferenceUser(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceUserRow, error)
	LockDomainPreferenceGroup(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceGroupRow, error)
	GetGrantedDomainPreference(context.Context, sqlc.GetGrantedDomainPreferenceParams) (pgtype.UUID, error)
	SaveUserDomainPreference(context.Context, sqlc.SaveUserDomainPreferenceParams) (sqlc.SaveUserDomainPreferenceRow, error)
}

// DomainPreferenceService reauthorizes personal domain choices inside a bounded transaction.
type DomainPreferenceService struct {
	store domainPreferenceStore
	inTx  func(context.Context, func(domainPreferenceStore, pgx.Tx) error) error
}

// NewDomainPreferenceService shares the existing domain write lock without sharing interface-preference versions.
func NewDomainPreferenceService(pool *pgxpool.Pool) *DomainPreferenceService {
	q := sqlc.New(pool)
	return &DomainPreferenceService{store: q, inTx: func(ctx context.Context, fn func(domainPreferenceStore, pgx.Tx) error) error {
		return appdb.WithTx(ctx, pool, func(tx pgx.Tx) error { return fn(q.WithTx(tx), tx) })
	}}
}

// Get reads a single current-account snapshot, even after creation permissions were revoked.
func (s *DomainPreferenceService) Get(ctx context.Context, actor auth.CurrentUser) (DomainPreferenceResult, error) {
	id, err := domainPreferenceActorID(actor)
	if err != nil {
		return DomainPreferenceResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.store.GetUserDomainPreference(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return DomainPreferenceResult{}, ErrPermissionDenied
	}
	if err != nil {
		return DomainPreferenceResult{}, err
	}
	return domainPreferenceResult(row.DomainID, row.UpdatedAt), nil
}

// Update locks current identity, grants and the domain before conditionally saving one revision.
func (s *DomainPreferenceService) Update(ctx context.Context, actor auth.CurrentUser, input UpdateDomainPreferenceInput) (DomainPreferenceResult, error) {
	id, err := domainPreferenceActorID(actor)
	if err != nil {
		return DomainPreferenceResult{}, err
	}
	var selected pgtype.UUID
	if input.DomainID != nil {
		value, parseErr := uuid.Parse(*input.DomainID)
		if parseErr != nil || value == uuid.Nil || value.String() != *input.DomainID {
			return DomainPreferenceResult{}, ErrInvalidInput
		}
		selected = uuidToPgtype(value)
	}
	var expected pgtype.Timestamptz
	if input.ExpectedUpdatedAt != nil {
		if !preferencesVersionPattern.MatchString(*input.ExpectedUpdatedAt) {
			return DomainPreferenceResult{}, ErrInvalidInput
		}
		value, parseErr := time.Parse(time.RFC3339Nano, *input.ExpectedUpdatedAt)
		if parseErr != nil || value.IsZero() {
			return DomainPreferenceResult{}, ErrInvalidInput
		}
		expected = pgtype.Timestamptz{Time: value, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result DomainPreferenceResult
	err = s.inTx(ctx, func(q domainPreferenceStore, tx pgx.Tx) error {
		if err := domain.LockShortLinkCreation(ctx, tx); err != nil {
			return err
		}
		current, err := q.LockDomainPreferenceUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		group, err := q.LockDomainPreferenceGroup(ctx, current.GroupID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if selected.Valid {
			grants, err := permission.DecodeSnapshot(group.Permissions)
			if err != nil {
				return err
			}
			if !grants.Has(permission.ShortLinkCreate) {
				return ErrPermissionDenied
			}
			_, err = q.GetGrantedDomainPreference(ctx, sqlc.GetGrantedDomainPreferenceParams{
				DomainID: selected, GroupID: group.ID,
				CanDefault: grants.Has(permission.DomainUseDefault), CanAssigned: grants.Has(permission.DomainUseAssigned),
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPermissionDenied
			}
			if err != nil {
				return err
			}
		}
		if expected.Valid && expected.Time.Nanosecond()%1000 != 0 {
			return ErrPreferencesConflict
		}
		row, err := q.SaveUserDomainPreference(ctx, sqlc.SaveUserDomainPreferenceParams{
			UserID: id, DomainID: selected, ExpectedUpdatedAt: expected,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPreferencesConflict
		}
		if err != nil {
			return err
		}
		result = domainPreferenceResult(row.DomainID, row.UpdatedAt)
		return nil
	})
	if err != nil {
		return DomainPreferenceResult{}, err
	}
	return result, nil
}

// domainPreferenceActorID rejects anonymous and noncanonical identities before database access.
func domainPreferenceActorID(actor auth.CurrentUser) (pgtype.UUID, error) {
	id, err := uuid.Parse(actor.ID)
	if err != nil || id == uuid.Nil || id.String() != actor.ID {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return uuidToPgtype(id), nil
}

// domainPreferenceResult preserves unset fields and full PostgreSQL timestamp precision.
func domainPreferenceResult(id pgtype.UUID, revision pgtype.Timestamptz) DomainPreferenceResult {
	result := DomainPreferenceResult{}
	if id.Valid {
		value := uuid.UUID(id.Bytes).String()
		result.Preference.DomainID = &value
	}
	if revision.Valid {
		value := revision.Time.UTC().Format(time.RFC3339Nano)
		result.Preference.UpdatedAt = &value
	}
	return result
}
