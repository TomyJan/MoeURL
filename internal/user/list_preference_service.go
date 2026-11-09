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

// ListPreference is an independent personal default, never an authorization.
type ListPreference struct {
	PageSize  *int16  `json:"pageSize"`
	UpdatedAt *string `json:"updatedAt"`
}

type ListPreferenceResult struct {
	Preference ListPreference `json:"preference"`
}

type UpdateListPreferenceInput struct {
	PageSize          *int16
	ExpectedUpdatedAt *string
}

// ListPreferenceService reads current authority and serializes writes with account and group changes.
type ListPreferenceService struct {
	pool *pgxpool.Pool
	q    *sqlc.Queries
}

func NewListPreferenceService(pool *pgxpool.Pool) *ListPreferenceService {
	return &ListPreferenceService{pool: pool, q: sqlc.New(pool)}
}

func listPreferenceActorID(actor auth.CurrentUser) (pgtype.UUID, error) {
	id, err := uuid.Parse(actor.ID)
	if actor.GroupKey == permission.GroupGuest || err != nil || id == uuid.Nil || id.String() != actor.ID {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return uuidToPgtype(id), nil
}

func (s *ListPreferenceService) Get(ctx context.Context, actor auth.CurrentUser) (ListPreferenceResult, error) {
	id, err := listPreferenceActorID(actor)
	if err != nil {
		return ListPreferenceResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.q.GetUserListPreference(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ListPreferenceResult{}, ErrPermissionDenied
	}
	if err != nil {
		return ListPreferenceResult{}, err
	}
	return listPreferenceResult(row.PageSize, row.UpdatedAt), nil
}

// Update validates full precision before SQLC could round a version to microseconds.
func (s *ListPreferenceService) Update(ctx context.Context, actor auth.CurrentUser, input UpdateListPreferenceInput) (ListPreferenceResult, error) {
	id, err := listPreferenceActorID(actor)
	if err != nil {
		return ListPreferenceResult{}, err
	}
	var size pgtype.Int2
	if input.PageSize != nil {
		switch *input.PageSize {
		case 20, 50, 100:
			size = pgtype.Int2{Int16: *input.PageSize, Valid: true}
		default:
			return ListPreferenceResult{}, ErrInvalidInput
		}
	}
	var expected pgtype.Timestamptz
	if input.ExpectedUpdatedAt != nil {
		if !preferencesVersionPattern.MatchString(*input.ExpectedUpdatedAt) {
			return ListPreferenceResult{}, ErrInvalidInput
		}
		parsed, err := time.Parse(time.RFC3339Nano, *input.ExpectedUpdatedAt)
		if err != nil || parsed.IsZero() {
			return ListPreferenceResult{}, ErrInvalidInput
		}
		expected = pgtype.Timestamptz{Time: parsed, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result ListPreferenceResult
	err = appdb.WithTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := s.q.WithTx(tx)
		current, err := q.LockListPreferenceUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		_, err = q.LockListPreferenceGroup(ctx, current.GroupID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if expected.Valid && expected.Time.Nanosecond()%1000 != 0 {
			return ErrPreferencesConflict
		}
		row, err := q.SaveUserListPreference(ctx, sqlc.SaveUserListPreferenceParams{UserID: id, PageSize: size, ExpectedUpdatedAt: expected})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPreferencesConflict
		}
		if err != nil {
			return err
		}
		result = listPreferenceResult(row.PageSize, row.UpdatedAt)
		return nil
	})
	if err != nil {
		return ListPreferenceResult{}, err
	}
	return result, nil
}

func listPreferenceResult(size pgtype.Int2, revision pgtype.Timestamptz) ListPreferenceResult {
	result := ListPreferenceResult{}
	if size.Valid {
		result.Preference.PageSize = &size.Int16
	}
	if revision.Valid {
		value := revision.Time.UTC().Format(time.RFC3339Nano)
		result.Preference.UpdatedAt = &value
	}
	return result
}
