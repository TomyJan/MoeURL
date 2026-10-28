package domain

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// RedirectDefaultSetting keeps domain configuration out of the legacy strict DTO.
type RedirectDefaultSetting struct {
	DomainID     string `json:"domainId"`
	RedirectMode string `json:"redirectMode"`
	UpdatedAt    string `json:"updatedAt"`
}

// SetRedirectDefaultInput changes only a mode against the complete domain revision.
type SetRedirectDefaultInput struct {
	ID                string
	RedirectMode      string
	ExpectedUpdatedAt string
}

// EffectiveRedirectDefault exposes no unavailable identifiers or management metadata.
type EffectiveRedirectDefault struct {
	DomainID     string `json:"domainId"`
	RedirectMode string `json:"redirectMode"`
}

var errStoredRedirectDefault = errors.New("invalid stored domain redirect default")

// redirectDefaultReadStore restricts consistent reads to current identity and configuration.
type redirectDefaultReadStore interface {
	GetDomainRedirectDefaultActor(context.Context, pgtype.UUID) (sqlc.GetDomainRedirectDefaultActorRow, error)
	GetDomainRedirectDefault(context.Context, pgtype.UUID) (sqlc.Domain, error)
	ListEffectiveDomainRedirectDefaults(context.Context, sqlc.ListEffectiveDomainRedirectDefaultsParams) ([]sqlc.ListEffectiveDomainRedirectDefaultsRow, error)
}

// redirectDefaultWriteStore shares the existing actor locks and the target's CAS boundary.
type redirectDefaultWriteStore interface {
	domainWriterStore
	GetDomainRedirectDefaultForUpdate(context.Context, pgtype.UUID) (sqlc.Domain, error)
	SetDomainRedirectDefault(context.Context, sqlc.SetDomainRedirectDefaultParams) (sqlc.Domain, error)
}

// GetRedirectDefault reads current administrator authority and configuration from one snapshot.
func (s *Service) GetRedirectDefault(ctx context.Context, actor auth.CurrentUser, id string) (RedirectDefaultSetting, error) {
	target, err := canonicalRedirectDefaultID(id)
	if err != nil {
		return RedirectDefaultSetting{}, ErrInvalidInput
	}
	var result RedirectDefaultSetting
	err = s.withRedirectDefaultRead(ctx, actor, func(ctx context.Context, q redirectDefaultReadStore, current sqlc.GetDomainRedirectDefaultActorRow, grants permission.Snapshot) error {
		if current.Key != permission.GroupAdmin || !grants.Has(permission.AdminAccess) || !grants.Has(permission.DomainManage) {
			return ErrPermissionDenied
		}
		row, err := q.GetDomainRedirectDefault(ctx, pgUUID(target))
		if err != nil {
			return mapNotFound(err)
		}
		result, err = redirectDefaultSetting(row)
		return err
	})
	if err != nil {
		return RedirectDefaultSetting{}, err
	}
	return result, nil
}

// SetRedirectDefault reauthorizes after all prior domain writes and atomically audits real changes.
func (s *Service) SetRedirectDefault(ctx context.Context, actor auth.CurrentUser, input SetRedirectDefaultInput) (RedirectDefaultSetting, error) {
	if _, err := canonicalRedirectDefaultID(actor.ID); err != nil {
		return RedirectDefaultSetting{}, ErrPermissionDenied
	}
	id, err := canonicalRedirectDefaultID(input.ID)
	if err != nil || !validRedirectDefaultMode(input.RedirectMode) || !domainOrderVersionPattern.MatchString(input.ExpectedUpdatedAt) {
		return RedirectDefaultSetting{}, ErrInvalidInput
	}
	expected, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || expected.IsZero() {
		return RedirectDefaultSetting{}, ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result RedirectDefaultSetting
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		if err := lockDomainWrites(ctx, tx); err != nil {
			return err
		}
		var err error
		result, err = applyDomainRedirectDefault(ctx, s.queries.WithTx(tx), actor.ID, pgUUID(id), expected, input.RedirectMode)
		return err
	})
	if err != nil {
		return RedirectDefaultSetting{}, err
	}
	return result, nil
}

// applyDomainRedirectDefault compares the revision before recognizing a no-op.
func applyDomainRedirectDefault(ctx context.Context, q redirectDefaultWriteStore, actorID string, id pgtype.UUID, expected time.Time, mode string) (RedirectDefaultSetting, error) {
	if err := authorizeDomainWriter(ctx, q, actorID); err != nil {
		return RedirectDefaultSetting{}, err
	}
	row, err := q.GetDomainRedirectDefaultForUpdate(ctx, id)
	if err != nil {
		return RedirectDefaultSetting{}, mapNotFound(err)
	}
	if !row.UpdatedAt.Time.Equal(expected) {
		return RedirectDefaultSetting{}, ErrVersionConflict
	}
	if row.DefaultRedirectMode != mode {
		row, err = q.SetDomainRedirectDefault(ctx, sqlc.SetDomainRedirectDefaultParams{ID: id, RedirectMode: mode, ExpectedUpdatedAt: row.UpdatedAt})
		if errors.Is(err, pgx.ErrNoRows) {
			return RedirectDefaultSetting{}, ErrVersionConflict
		}
		if err != nil {
			return RedirectDefaultSetting{}, err
		}
	}
	return redirectDefaultSetting(row)
}

// RedirectDefaults returns only current authorized domains and never grants a mode capability.
func (s *Service) RedirectDefaults(ctx context.Context, actor auth.CurrentUser) ([]EffectiveRedirectDefault, error) {
	result := make([]EffectiveRedirectDefault, 0)
	err := s.withRedirectDefaultRead(ctx, actor, func(ctx context.Context, q redirectDefaultReadStore, current sqlc.GetDomainRedirectDefaultActorRow, grants permission.Snapshot) error {
		if !grants.Has(permission.ShortLinkCreate) {
			return nil
		}
		rows, err := q.ListEffectiveDomainRedirectDefaults(ctx, sqlc.ListEffectiveDomainRedirectDefaultsParams{
			GroupID: current.GroupID, CanDefault: grants.Has(permission.DomainUseDefault), CanAssigned: grants.Has(permission.DomainUseAssigned),
			CanIntermediate: grants.Has(permission.ShortLinkUseIntermediate), CanConfirmation: grants.Has(permission.ShortLinkUseConfirmation),
		})
		if err != nil {
			return err
		}
		for _, row := range rows {
			if !validRedirectDefaultMode(row.RedirectMode) {
				return errStoredRedirectDefault
			}
			result = append(result, EffectiveRedirectDefault{DomainID: uuid.UUID(row.ID.Bytes).String(), RedirectMode: row.RedirectMode})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// withRedirectDefaultRead binds authorization and domain reads to a bounded, read-only snapshot.
func (s *Service) withRedirectDefaultRead(ctx context.Context, actor auth.CurrentUser, fn func(context.Context, redirectDefaultReadStore, sqlc.GetDomainRedirectDefaultActorRow, permission.Snapshot) error) error {
	id, err := canonicalRedirectDefaultID(actor.ID)
	if err != nil {
		return ErrPermissionDenied
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tx, err := s.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.queries.WithTx(tx)
	current, err := q.GetDomainRedirectDefaultActor(ctx, pgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPermissionDenied
	}
	if err != nil {
		return err
	}
	grants, err := permission.DecodeSnapshot(current.Permissions)
	if err != nil {
		return err
	}
	if err := fn(ctx, q, current, grants); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// canonicalRedirectDefaultID rejects nil and alternative UUID encodings before storage access.
func canonicalRedirectDefaultID(value string) (uuid.UUID, error) {
	id, err := uuid.Parse(value)
	if err != nil || id == uuid.Nil || id.String() != value {
		return uuid.Nil, ErrInvalidInput
	}
	return id, nil
}

// validRedirectDefaultMode permits only the three existing saved short-link modes.
func validRedirectDefaultMode(mode string) bool {
	return mode == "direct" || mode == "intermediate" || mode == "confirmation"
}

// redirectDefaultSetting fails closed on corrupt persistence instead of inventing a direct value.
func redirectDefaultSetting(row sqlc.Domain) (RedirectDefaultSetting, error) {
	if !validRedirectDefaultMode(row.DefaultRedirectMode) {
		return RedirectDefaultSetting{}, errStoredRedirectDefault
	}
	return RedirectDefaultSetting{DomainID: uuid.UUID(row.ID.Bytes).String(), RedirectMode: row.DefaultRedirectMode, UpdatedAt: row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano)}, nil
}
