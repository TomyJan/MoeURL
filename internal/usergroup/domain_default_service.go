package usergroup

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

// DomainDefaultSetting is independent of the legacy strict permission DTO, but shares its group revision.
type DomainDefaultSetting struct {
	GroupKey  string  `json:"groupKey"`
	DomainID  *string `json:"domainId"`
	UpdatedAt string  `json:"updatedAt"`
	Editable  bool    `json:"editable"`
}

// DomainDefaultCandidate contains only the target group's currently authorized creation choices.
type DomainDefaultCandidate struct {
	ID          string `json:"id"`
	Host        string `json:"host"`
	DisplayName string `json:"displayName"`
	IsDefault   bool   `json:"isDefault"`
}

// DomainDefaultResult pairs the saved group resource with its current eligible candidates.
type DomainDefaultResult struct {
	Setting    DomainDefaultSetting     `json:"setting"`
	Candidates []DomainDefaultCandidate `json:"candidates"`
}

// CurrentDomainDefaultResult masks unavailable saved identifiers and exposes no domain metadata.
type CurrentDomainDefaultResult struct {
	Selection struct {
		DomainID *string `json:"domainId"`
		Status   string  `json:"status"`
	} `json:"selection"`
}

// SetDomainDefaultInput replaces only the selected group's nullable domain against its saved revision.
type SetDomainDefaultInput struct {
	GroupKey          string
	DomainID          *string
	ExpectedUpdatedAt string
}

// DomainDefaultPort exposes management and current-account projections without extending the old Port.
type DomainDefaultPort interface {
	Get(context.Context, auth.CurrentUser, string) (DomainDefaultResult, error)
	Set(context.Context, auth.CurrentUser, SetDomainDefaultInput) (DomainDefaultResult, error)
	GetCurrent(context.Context, auth.CurrentUser) (CurrentDomainDefaultResult, error)
}

type groupDefaultStore interface {
	groupWriterStore
	GetUserGroupByKey(context.Context, string) (sqlc.UserGroup, error)
	GetGroupDefaultReadActor(context.Context, pgtype.UUID) ([]byte, error)
	GetCurrentGroupDefaultDomain(context.Context, pgtype.UUID) (sqlc.GetCurrentGroupDefaultDomainRow, error)
	ListGroupDefaultCandidates(context.Context, sqlc.ListGroupDefaultCandidatesParams) ([]sqlc.ListGroupDefaultCandidatesRow, error)
	LockGroupDefaultTarget(context.Context, string) (sqlc.UserGroup, error)
	GetGrantedDomainPreference(context.Context, sqlc.GetGrantedDomainPreferenceParams) (pgtype.UUID, error)
	SetUserGroupDefaultDomain(context.Context, sqlc.SetUserGroupDefaultDomainParams) (sqlc.UserGroup, error)
}

// DomainDefaultService keeps each read snapshot and each audited write within one bounded operation.
type DomainDefaultService struct {
	store   groupDefaultStore
	inRead  func(context.Context, func(groupDefaultStore) error) error
	inWrite func(context.Context, string, func(groupDefaultStore, pgx.Tx) error) error
}

// NewDomainDefaultService uses repeatable-read management snapshots and the existing audit transaction owner.
func NewDomainDefaultService(pool *pgxpool.Pool) *DomainDefaultService {
	q := sqlc.New(pool)
	return &DomainDefaultService{
		store: q,
		inRead: func(ctx context.Context, fn func(groupDefaultStore) error) error {
			tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
			if err != nil {
				return err
			}
			defer func() { _ = tx.Rollback(ctx) }()
			if err := fn(q.WithTx(tx)); err != nil {
				return err
			}
			return tx.Commit(ctx)
		},
		inWrite: func(ctx context.Context, actor string, fn func(groupDefaultStore, pgx.Tx) error) error {
			return appdb.WithAuditTx(ctx, pool, actor, func(tx pgx.Tx) error { return fn(q.WithTx(tx), tx) })
		},
	}
}

// Get authorizes the current database actor and reads the group/candidate projection from the same snapshot.
func (s *DomainDefaultService) Get(ctx context.Context, actor auth.CurrentUser, groupKey string) (DomainDefaultResult, error) {
	actorID, err := groupWriterID(actor.ID)
	if err != nil {
		return DomainDefaultResult{}, err
	}
	if stableGroupKey(groupKey) == "" {
		return DomainDefaultResult{}, ErrInvalidInput
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result DomainDefaultResult
	err = s.inRead(ctx, func(q groupDefaultStore) error {
		stored, err := q.GetGroupDefaultReadActor(ctx, actorID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		grants, err := decodeGroupConfigurationPermissions(stored)
		if err != nil {
			return err
		}
		if !grants.Has(permission.AdminAccess) || !grants.Has(permission.DomainManage) {
			return ErrPermissionDenied
		}
		group, err := q.GetUserGroupByKey(ctx, groupKey)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !group.Builtin) {
			return ErrUserGroupNotFound
		}
		if err != nil {
			return err
		}
		result, err = groupDefaultRepresentation(ctx, q, group)
		return err
	})
	if err != nil {
		return DomainDefaultResult{}, err
	}
	return result, nil
}

// Set rechecks current authority and target eligibility before a versioned, single-field write.
func (s *DomainDefaultService) Set(ctx context.Context, actor auth.CurrentUser, input SetDomainDefaultInput) (DomainDefaultResult, error) {
	actorID, err := groupWriterID(actor.ID)
	if err != nil {
		return DomainDefaultResult{}, err
	}
	if input.GroupKey == permission.GroupGuest {
		return DomainDefaultResult{}, ErrProtectedPermission
	}
	if input.GroupKey != permission.GroupUser && input.GroupKey != permission.GroupAdmin {
		return DomainDefaultResult{}, ErrInvalidInput
	}
	expected, err := time.Parse(time.RFC3339Nano, input.ExpectedUpdatedAt)
	if err != nil || expected.IsZero() || !groupRevisionPattern.MatchString(input.ExpectedUpdatedAt) {
		return DomainDefaultResult{}, ErrInvalidInput
	}
	var selected pgtype.UUID
	if input.DomainID != nil {
		id, err := uuid.Parse(*input.DomainID)
		if err != nil || id == uuid.Nil || id.String() != *input.DomainID {
			return DomainDefaultResult{}, ErrInvalidInput
		}
		selected = pgtype.UUID{Bytes: id, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result DomainDefaultResult
	err = s.inWrite(ctx, actor.ID, func(q groupDefaultStore, tx pgx.Tx) error {
		if err := domain.LockShortLinkCreation(ctx, tx); err != nil {
			return err
		}
		group, err := authorizeGroupWriter(ctx, q, actorID, true)
		if err != nil {
			return err
		}
		if input.GroupKey != permission.GroupAdmin {
			group, err = q.LockGroupDefaultTarget(ctx, input.GroupKey)
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrUserGroupNotFound
			}
			if err != nil {
				return err
			}
		}
		if !group.UpdatedAt.Time.Equal(expected) {
			return ErrPermissionConflict
		}
		grants, err := decodeGroupConfigurationPermissions(group.Permissions)
		if err != nil {
			return err
		}
		if selected.Valid {
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
		if selected.Valid != group.DefaultDomainID.Valid || (selected.Valid && selected.Bytes != group.DefaultDomainID.Bytes) {
			group, err = q.SetUserGroupDefaultDomain(ctx, sqlc.SetUserGroupDefaultDomainParams{
				DomainID: selected, GroupKey: input.GroupKey, ExpectedUpdatedAt: group.UpdatedAt,
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return ErrPermissionConflict
			}
			if err != nil {
				return err
			}
		}
		result, err = groupDefaultRepresentation(ctx, q, group)
		return err
	})
	if err != nil {
		return DomainDefaultResult{}, err
	}
	return result, nil
}

// GetCurrent computes availability from one current-account SQL snapshot and masks every ineligible UUID.
func (s *DomainDefaultService) GetCurrent(ctx context.Context, actor auth.CurrentUser) (CurrentDomainDefaultResult, error) {
	id, err := groupWriterID(actor.ID)
	if err != nil {
		return CurrentDomainDefaultResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.store.GetCurrentGroupDefaultDomain(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return CurrentDomainDefaultResult{}, ErrPermissionDenied
	}
	if err != nil {
		return CurrentDomainDefaultResult{}, err
	}
	grants, err := decodeGroupConfigurationPermissions(row.Permissions)
	if err != nil {
		return CurrentDomainDefaultResult{}, err
	}
	var result CurrentDomainDefaultResult
	result.Selection.Status = "not_set"
	if row.DefaultDomainID.Valid {
		result.Selection.Status = "unavailable"
		if row.AvailableDomainID.Valid && grants.Has(permission.ShortLinkCreate) &&
			((row.IsDefault.Bool && grants.Has(permission.DomainUseDefault)) || (!row.IsDefault.Bool && grants.Has(permission.DomainUseAssigned))) {
			result.Selection.Status = "available"
			value := uuid.UUID(row.AvailableDomainID.Bytes).String()
			result.Selection.DomainID = &value
		}
	}
	return result, nil
}

// groupDefaultRepresentation validates stored permissions before returning a bounded metadata projection.
func groupDefaultRepresentation(ctx context.Context, q groupDefaultStore, row sqlc.UserGroup) (DomainDefaultResult, error) {
	grants, err := decodeGroupConfigurationPermissions(row.Permissions)
	if err != nil {
		return DomainDefaultResult{}, err
	}
	result := DomainDefaultResult{
		Setting:    DomainDefaultSetting{GroupKey: row.Key, UpdatedAt: row.UpdatedAt.Time.UTC().Format(time.RFC3339Nano), Editable: row.Key != permission.GroupGuest},
		Candidates: make([]DomainDefaultCandidate, 0),
	}
	if !result.Setting.Editable {
		return result, nil
	}
	if row.DefaultDomainID.Valid {
		value := uuid.UUID(row.DefaultDomainID.Bytes).String()
		result.Setting.DomainID = &value
	}
	rows, err := q.ListGroupDefaultCandidates(ctx, sqlc.ListGroupDefaultCandidatesParams{
		GroupID: row.ID, CanCreate: grants.Has(permission.ShortLinkCreate),
		CanDefault: grants.Has(permission.DomainUseDefault), CanAssigned: grants.Has(permission.DomainUseAssigned),
	})
	if err != nil {
		return DomainDefaultResult{}, err
	}
	for _, item := range rows {
		result.Candidates = append(result.Candidates, DomainDefaultCandidate{
			ID: uuid.UUID(item.ID.Bytes).String(), Host: item.Host, DisplayName: item.DisplayName, IsDefault: item.IsDefault,
		})
	}
	return result, nil
}
