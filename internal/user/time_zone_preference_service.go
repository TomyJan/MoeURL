package user

import (
	"context"
	"errors"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TimeZonePreference stores a nullable display override with an independent CAS revision.
type TimeZonePreference struct {
	TimeZone  *string `json:"timeZone"`
	UpdatedAt *string `json:"updatedAt"`
}

// TimeZonePreferenceResult exposes only the request account's selected zone and revision.
type TimeZonePreferenceResult struct {
	Preference TimeZonePreference `json:"preference"`
}

// UpdateTimeZonePreferenceInput replaces one nullable zone at the submitted exact revision.
type UpdateTimeZonePreferenceInput struct {
	TimeZone          *string
	ExpectedUpdatedAt *string
}

type timeZonePreferenceStore interface {
	GetUserTimeZonePreference(context.Context, pgtype.UUID) (sqlc.GetUserTimeZonePreferenceRow, error)
	LockTimeZonePreferenceUser(context.Context, pgtype.UUID) (sqlc.LockTimeZonePreferenceUserRow, error)
	LockTimeZonePreferenceGroup(context.Context, pgtype.UUID) (pgtype.UUID, error)
	SaveUserTimeZonePreference(context.Context, sqlc.SaveUserTimeZonePreferenceParams) (sqlc.SaveUserTimeZonePreferenceRow, error)
}

// TimeZonePreferenceService rechecks current account eligibility in a bounded personal write.
type TimeZonePreferenceService struct {
	store timeZonePreferenceStore
	inTx  func(context.Context, func(timeZonePreferenceStore) error) error
}

// NewTimeZonePreferenceService keeps time-zone revisions independent from older account preferences.
func NewTimeZonePreferenceService(pool *pgxpool.Pool) *TimeZonePreferenceService {
	q := sqlc.New(pool)
	return &TimeZonePreferenceService{store: q, inTx: func(ctx context.Context, fn func(timeZonePreferenceStore) error) error {
		return appdb.WithTx(ctx, pool, func(tx pgx.Tx) error { return fn(q.WithTx(tx)) })
	}}
}

// Get returns an unset document only for a currently active, non-guest database identity.
func (s *TimeZonePreferenceService) Get(ctx context.Context, actor auth.CurrentUser) (TimeZonePreferenceResult, error) {
	id, err := timeZonePreferenceActorID(actor)
	if err != nil {
		return TimeZonePreferenceResult{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	row, err := s.store.GetUserTimeZonePreference(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return TimeZonePreferenceResult{}, ErrPermissionDenied
	}
	if err != nil {
		return TimeZonePreferenceResult{}, err
	}
	return timeZonePreferenceResult(row.TimeZone, row.UpdatedAt), nil
}

// Update locks account then current group before creating or CAS-replacing one personal revision.
func (s *TimeZonePreferenceService) Update(ctx context.Context, actor auth.CurrentUser, input UpdateTimeZonePreferenceInput) (TimeZonePreferenceResult, error) {
	id, err := timeZonePreferenceActorID(actor)
	if err != nil {
		return TimeZonePreferenceResult{}, err
	}
	if input.TimeZone != nil {
		switch *input.TimeZone {
		case "UTC", "Asia/Shanghai", "Asia/Singapore", "Asia/Tokyo", "Europe/London", "Europe/Paris", "America/New_York", "America/Los_Angeles", "Australia/Sydney":
		default:
			return TimeZonePreferenceResult{}, ErrInvalidInput
		}
	}
	var expected pgtype.Timestamptz
	if input.ExpectedUpdatedAt != nil {
		if !preferencesVersionPattern.MatchString(*input.ExpectedUpdatedAt) {
			return TimeZonePreferenceResult{}, ErrInvalidInput
		}
		parsed, parseErr := time.Parse(time.RFC3339Nano, *input.ExpectedUpdatedAt)
		if parseErr != nil || parsed.IsZero() {
			return TimeZonePreferenceResult{}, ErrInvalidInput
		}
		expected = pgtype.Timestamptz{Time: parsed, Valid: true}
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var result TimeZonePreferenceResult
	err = s.inTx(ctx, func(q timeZonePreferenceStore) error {
		current, err := q.LockTimeZonePreferenceUser(ctx, id)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		_, err = q.LockTimeZonePreferenceGroup(ctx, current.GroupID)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPermissionDenied
		}
		if err != nil {
			return err
		}
		if expected.Valid && expected.Time.Nanosecond()%1000 != 0 {
			return ErrPreferencesConflict
		}
		row, err := q.SaveUserTimeZonePreference(ctx, sqlc.SaveUserTimeZonePreferenceParams{UserID: id, TimeZone: preferenceText(input.TimeZone), ExpectedUpdatedAt: expected})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrPreferencesConflict
		}
		if err != nil {
			return err
		}
		result = timeZonePreferenceResult(row.TimeZone, row.UpdatedAt)
		return nil
	})
	if err != nil {
		return TimeZonePreferenceResult{}, err
	}
	return result, nil
}

// timeZonePreferenceActorID rejects guests and noncanonical identities before database access.
func timeZonePreferenceActorID(actor auth.CurrentUser) (pgtype.UUID, error) {
	id, err := uuid.Parse(actor.ID)
	if actor.GroupKey == "guest" || err != nil || id == uuid.Nil || id.String() != actor.ID {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return uuidToPgtype(id), nil
}

// timeZonePreferenceResult preserves nulls and the full PostgreSQL revision precision.
func timeZonePreferenceResult(zone pgtype.Text, revision pgtype.Timestamptz) TimeZonePreferenceResult {
	result := TimeZonePreferenceResult{}
	if zone.Valid {
		result.Preference.TimeZone = &zone.String
	}
	if revision.Valid {
		value := revision.Time.UTC().Format(time.RFC3339Nano)
		result.Preference.UpdatedAt = &value
	}
	return result
}
