package user

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
	"github.com/jackc/pgx/v5/pgxpool"
)

// RedirectPreference is an independent personal override, never a grant of permission.
type RedirectPreference struct {
	RedirectMode *string `json:"redirectMode"`
	UpdatedAt    *string `json:"updatedAt"`
}

type RedirectPreferenceResult struct {
	Preference RedirectPreference `json:"preference"`
}

type UpdateRedirectPreferenceInput struct {
	RedirectMode      *string
	ExpectedUpdatedAt *string
}

type redirectPreferenceStore interface {
	GetUserRedirectPreference(context.Context, pgtype.UUID) (sqlc.GetUserRedirectPreferenceRow, error)
	LockRedirectPreferenceUser(context.Context, pgtype.UUID) (sqlc.LockRedirectPreferenceUserRow, error)
	LockRedirectPreferenceGroup(context.Context, pgtype.UUID) (sqlc.LockRedirectPreferenceGroupRow, error)
	SaveUserRedirectPreference(context.Context, sqlc.SaveUserRedirectPreferenceParams) (sqlc.SaveUserRedirectPreferenceRow, error)
}

// RedirectPreferenceService checks current database authority while holding account and group locks.
type RedirectPreferenceService struct {
	store redirectPreferenceStore
	inTx  func(context.Context, func(redirectPreferenceStore) error) error
}

// NewRedirectPreferenceService binds reads and transactional writes to the same pool.
func NewRedirectPreferenceService(pool *pgxpool.Pool) *RedirectPreferenceService {
	q := sqlc.New(pool)
	return &RedirectPreferenceService{store: q, inTx: func(ctx context.Context, fn func(redirectPreferenceStore) error) error {
		return appdb.WithTx(ctx, pool, func(tx pgx.Tx) error { return fn(q.WithTx(tx)) })
	}}
}

// Get includes revoked saved values so their owner can see and clear them.
func (s *RedirectPreferenceService) Get(ctx context.Context, actor auth.CurrentUser) (RedirectPreferenceResult, error) {
	id, err := redirectPreferenceActorID(actor)
	if err != nil {
		return RedirectPreferenceResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.store.GetUserRedirectPreference(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return RedirectPreferenceResult{}, ErrPermissionDenied
	}
	if err != nil {
		return RedirectPreferenceResult{}, err
	}
	return redirectPreferenceResult(row.RedirectMode, row.UpdatedAt), nil
}

// Update uses exact CAS only after rechecking the locked current group, not the session's old group key.
func (s *RedirectPreferenceService) Update(ctx context.Context, actor auth.CurrentUser, input UpdateRedirectPreferenceInput) (RedirectPreferenceResult, error) {
	id, err := redirectPreferenceActorID(actor)
	if err != nil {
		return RedirectPreferenceResult{}, err
	}
	required := ""
	if input.RedirectMode != nil {
		switch *input.RedirectMode {
		case "direct":
		case "intermediate":
			required = permission.ShortLinkUseIntermediate
		case "confirmation":
			required = permission.ShortLinkUseConfirmation
		default:
			return RedirectPreferenceResult{}, ErrInvalidInput
		}
	}
	var expected pgtype.Timestamptz
	if input.ExpectedUpdatedAt != nil {
		if !preferencesVersionPattern.MatchString(*input.ExpectedUpdatedAt) {
			return RedirectPreferenceResult{}, ErrInvalidInput
		}
		parsed, parseErr := time.Parse(time.RFC3339Nano, *input.ExpectedUpdatedAt)
		if parseErr != nil || parsed.IsZero() {
			return RedirectPreferenceResult{}, ErrInvalidInput
		}
		expected = pgtype.Timestamptz{Time: parsed, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result RedirectPreferenceResult
	err = s.inTx(ctx, func(q redirectPreferenceStore) error {
		current, err := q.LockRedirectPreferenceUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		group, err := q.LockRedirectPreferenceGroup(ctx, current.GroupID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if required != "" {
			permissions, err := permission.DecodeSnapshot(group.Permissions)
			if err != nil {
				return err
			}
			if !permissions.Has(required) {
				return ErrPermissionDenied
			}
		}
		if expected.Valid && expected.Time.Nanosecond()%1000 != 0 {
			return ErrPreferencesConflict
		}
		row, err := q.SaveUserRedirectPreference(ctx, sqlc.SaveUserRedirectPreferenceParams{
			UserID: id, RedirectMode: preferenceText(input.RedirectMode), ExpectedUpdatedAt: expected,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPreferencesConflict
		}
		if err != nil {
			return err
		}
		result = redirectPreferenceResult(row.RedirectMode, row.UpdatedAt)
		return nil
	})
	if err != nil {
		return RedirectPreferenceResult{}, err
	}
	return result, nil
}

// redirectPreferenceActorID rejects guest, nil and noncanonical identifiers before storage access.
func redirectPreferenceActorID(actor auth.CurrentUser) (pgtype.UUID, error) {
	id, err := uuid.Parse(actor.ID)
	if actor.GroupKey == permission.GroupGuest || err != nil || id == uuid.Nil || id.String() != actor.ID {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return uuidToPgtype(id), nil
}

// redirectPreferenceResult preserves nullable values and PostgreSQL revision precision in UTC.
func redirectPreferenceResult(mode pgtype.Text, revision pgtype.Timestamptz) RedirectPreferenceResult {
	result := RedirectPreferenceResult{}
	if mode.Valid {
		result.Preference.RedirectMode = &mode.String
	}
	if revision.Valid {
		value := revision.Time.UTC().Format(time.RFC3339Nano)
		result.Preference.UpdatedAt = &value
	}
	return result
}
