package system

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"slices"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FooterLinksService owns only the independent ordered navigation resource.
type FooterLinksService struct {
	pool    *pgxpool.Pool
	queries *sqlc.Queries
}

func NewFooterLinksService(pool *pgxpool.Pool) *FooterLinksService {
	return &FooterLinksService{pool: pool, queries: sqlc.New(pool)}
}

// ValidateStartup fails closed instead of silently replacing missing content.
func (s *FooterLinksService) ValidateStartup(ctx context.Context) error {
	_, err := s.PublicFooterLinks(ctx)
	return err
}

// PublicFooterLinks validates persisted content before discarding its private
// revision; corrupt storage is an error rather than an implicit empty default.
func (s *FooterLinksService) PublicFooterLinks(ctx context.Context) (FooterLinks, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.queries.GetSystemSetting(ctx, footerLinksKey)
	if err != nil {
		return FooterLinks{}, err
	}
	stored, err := storedFooterLinks(row)
	return stored.FooterLinks, err
}

// GetFooterLinks reads current account authority and content in one bounded
// repeatable-read snapshot, never using cached role or permission assertions.
func (s *FooterLinksService) GetFooterLinks(ctx context.Context, actor auth.CurrentUser) (FooterLinksSettings, error) {
	id, err := footerLinksActorID(actor.ID)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result FooterLinksSettings
	err = pgx.BeginTxFunc(ctx, s.pool, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		q := s.queries.WithTx(tx)
		grants, err := q.GetFooterLinksActor(ctx, id)
		if err := authorizeFooterLinksPermissions(grants, err); err != nil {
			return err
		}
		row, err := q.GetSystemSetting(ctx, footerLinksKey)
		if err != nil {
			return err
		}
		result, err = storedFooterLinks(row)
		return err
	})
	if err != nil {
		return FooterLinksSettings{}, err
	}
	return result, nil
}

type footerLinksWriteStore interface {
	LockFooterLinksActor(context.Context, pgtype.UUID) (pgtype.UUID, error)
	LockFooterLinksGroup(context.Context, pgtype.UUID) ([]byte, error)
	GetSystemSettingForUpdate(context.Context, string) (sqlc.SystemSetting, error)
	UpdateSystemSettingValue(context.Context, sqlc.UpdateSystemSettingValueParams) (sqlc.SystemSetting, error)
}

// UpdateFooterLinks validates input before opening a bounded transaction, then
// commits the locked authorization, full-version comparison and audit together.
func (s *FooterLinksService) UpdateFooterLinks(ctx context.Context, actor auth.CurrentUser, input UpdateFooterLinksInput) (FooterLinksSettings, error) {
	id, err := footerLinksActorID(actor.ID)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	content, err := normalizeFooterLinks(input.Links)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	expected, err := footerLinksVersion(input.ExpectedUpdatedAt)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result FooterLinksSettings
	err = appdb.WithAuditTx(ctx, s.pool, actor.ID, func(tx pgx.Tx) error {
		var err error
		result, err = applyFooterLinks(ctx, s.queries.WithTx(tx), id, content, expected)
		return err
	})
	if err != nil {
		return FooterLinksSettings{}, err
	}
	return result, nil
}

// applyFooterLinks locks actor, current group, then content; compares the full
// revision before no-op detection and commits each real change with its audit.
func applyFooterLinks(ctx context.Context, q footerLinksWriteStore, id pgtype.UUID, content FooterLinks, expected time.Time) (FooterLinksSettings, error) {
	group, err := q.LockFooterLinksActor(ctx, id)
	if err != nil {
		return FooterLinksSettings{}, footerLinksIdentityError(err)
	}
	grants, err := q.LockFooterLinksGroup(ctx, group)
	if err := authorizeFooterLinksPermissions(grants, err); err != nil {
		return FooterLinksSettings{}, err
	}
	row, err := q.GetSystemSettingForUpdate(ctx, footerLinksKey)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	current, err := storedFooterLinks(row)
	if err != nil {
		return FooterLinksSettings{}, err
	}
	if !row.UpdatedAt.Time.Equal(expected) {
		return FooterLinksSettings{}, ErrFooterLinksConflict
	}
	if slices.Equal(current.Links, content.Links) {
		return current, nil
	}
	value, _ := json.Marshal(content) // Only validated strings and a slice: encoding cannot fail.
	next := time.Now().UTC().Truncate(time.Microsecond)
	if !next.After(row.UpdatedAt.Time) {
		next = row.UpdatedAt.Time.Add(time.Microsecond)
	}
	row, err = q.UpdateSystemSettingValue(ctx, sqlc.UpdateSystemSettingValueParams{Key: footerLinksKey, Value: value, UpdatedAt: pgtype.Timestamptz{Time: next, Valid: true}})
	if err != nil {
		return FooterLinksSettings{}, err
	}
	return storedFooterLinks(row)
}

func footerLinksActorID(raw string) (pgtype.UUID, error) {
	id, err := uuid.Parse(raw)
	if err != nil || id == uuid.Nil || id.String() != raw {
		return pgtype.UUID{}, ErrSettingsPermissionDenied
	}
	return pgtype.UUID{Bytes: id, Valid: true}, nil
}

func footerLinksIdentityError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSettingsPermissionDenied
	}
	return err
}

func authorizeFooterLinksPermissions(raw []byte, err error) error {
	if err != nil {
		return footerLinksIdentityError(err)
	}
	if value := bytes.TrimSpace(raw); len(value) == 0 || value[0] != '[' {
		return ErrCorruptFooterLinks
	}
	grants, err := permission.DecodeSnapshot(raw)
	if err != nil {
		return ErrCorruptFooterLinks
	}
	if !grants.Has(permission.AdminAccess) || !grants.Has(permission.SystemManage) {
		return ErrSettingsPermissionDenied
	}
	return nil
}
