package user

import (
	"context"
	"errors"
	"regexp"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrPreferencesConflict means the submitted version cannot replace the account's current settings.
var ErrPreferencesConflict = errors.New("preferences conflict")

// preferencesVersionPattern bounds fractional precision before time.Parse can silently discard digits.
var preferencesVersionPattern = regexp.MustCompile(`^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,9})?(Z|[+-](0[0-9]|1[0-9]|2[0-3]):[0-5][0-9])$`)

// Preferences contains nullable account overrides; null fields preserve browser and site defaults.
type Preferences struct {
	Language  *string `json:"language"`
	Theme     *string `json:"theme"`
	UpdatedAt *string `json:"updatedAt"`
}

// PreferencesResult keeps the same response shape for saved and never-created account settings.
type PreferencesResult struct {
	Preferences Preferences `json:"preferences"`
}

// UpdatePreferencesInput replaces both overrides; a null expected version permits only first creation.
type UpdatePreferencesInput struct {
	Language          *string
	Theme             *string
	ExpectedUpdatedAt *string
}

type preferencesStore interface {
	GetUserPreferences(context.Context, pgtype.UUID) (sqlc.GetUserPreferencesRow, error)
	SaveUserPreferences(context.Context, sqlc.SaveUserPreferencesParams) (sqlc.SaveUserPreferencesRow, error)
}

// PreferencesService isolates personal settings from profile edits and administrator permissions.
type PreferencesService struct{ store preferencesStore }

// NewPreferencesService stores account preferences separately from user profile versions.
func NewPreferencesService(pool *pgxpool.Pool) *PreferencesService {
	return &PreferencesService{store: sqlc.New(pool)}
}

// Get returns only the current eligible account's preferences, including an unset record.
func (s *PreferencesService) Get(ctx context.Context, actor auth.CurrentUser) (PreferencesResult, error) {
	id, err := preferencesActorID(actor)
	if err != nil {
		return PreferencesResult{}, err
	}
	row, err := s.store.GetUserPreferences(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return PreferencesResult{}, ErrPermissionDenied
	}
	if err != nil {
		return PreferencesResult{}, err
	}
	return preferencesResult(row.Language, row.Theme, row.UpdatedAt), nil
}

// Update atomically creates or conditionally updates preferences for an active account.
func (s *PreferencesService) Update(ctx context.Context, actor auth.CurrentUser, input UpdatePreferencesInput) (PreferencesResult, error) {
	id, err := preferencesActorID(actor)
	if err != nil {
		return PreferencesResult{}, err
	}
	if input.Language != nil && *input.Language != "zh-CN" && *input.Language != "en" {
		return PreferencesResult{}, ErrInvalidInput
	}
	if input.Theme != nil && *input.Theme != "system" && *input.Theme != "light" && *input.Theme != "dark" {
		return PreferencesResult{}, ErrInvalidInput
	}
	var expected pgtype.Timestamptz
	if input.ExpectedUpdatedAt != nil {
		if !preferencesVersionPattern.MatchString(*input.ExpectedUpdatedAt) {
			return PreferencesResult{}, ErrInvalidInput
		}
		version, parseErr := time.Parse(time.RFC3339Nano, *input.ExpectedUpdatedAt)
		if parseErr != nil {
			return PreferencesResult{}, ErrInvalidInput
		}
		expected = pgtype.Timestamptz{Time: version, Valid: true}
	}
	var row sqlc.SaveUserPreferencesRow
	if expected.Valid && expected.Time.Nanosecond()%1000 != 0 {
		// PostgreSQL versions have microsecond precision; never round a different version into a match.
		err = pgx.ErrNoRows
	} else {
		row, err = s.store.SaveUserPreferences(ctx, sqlc.SaveUserPreferencesParams{
			UserID: id, Language: preferenceText(input.Language), Theme: preferenceText(input.Theme), ExpectedUpdatedAt: expected,
		})
	}
	if errors.Is(err, pgx.ErrNoRows) {
		if _, readErr := s.Get(ctx, actor); readErr != nil {
			return PreferencesResult{}, readErr
		}
		return PreferencesResult{}, ErrPreferencesConflict
	}
	if err != nil {
		return PreferencesResult{}, err
	}
	return preferencesResult(row.Language, row.Theme, row.UpdatedAt), nil
}

// preferencesActorID rejects unauthenticated identities before reaching the database.
func preferencesActorID(actor auth.CurrentUser) (pgtype.UUID, error) {
	if actor.GroupKey == "guest" || actor.ID == "" {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	id, err := uuid.Parse(actor.ID)
	if err != nil {
		return pgtype.UUID{}, ErrPermissionDenied
	}
	return uuidToPgtype(id), nil
}

// preferenceText preserves null instead of persisting an implicit browser default.
func preferenceText(value *string) pgtype.Text {
	if value == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *value, Valid: true}
}

// preferencesResult exposes nullable settings and a precise UTC concurrency version.
func preferencesResult(language, theme pgtype.Text, updatedAt pgtype.Timestamptz) PreferencesResult {
	result := PreferencesResult{}
	if language.Valid {
		result.Preferences.Language = &language.String
	}
	if theme.Valid {
		result.Preferences.Theme = &theme.String
	}
	if updatedAt.Valid {
		version := updatedAt.Time.UTC().Format(time.RFC3339Nano)
		result.Preferences.UpdatedAt = &version
	}
	return result
}
