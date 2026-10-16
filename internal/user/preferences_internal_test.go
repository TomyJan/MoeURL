package user

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

type preferenceFaultStore struct {
	readErr, writeErr error
	reads, writes     int
}

// GetUserPreferences provides controlled database failures without changing service behavior.
func (s *preferenceFaultStore) GetUserPreferences(context.Context, pgtype.UUID) (sqlc.GetUserPreferencesRow, error) {
	s.reads++
	return sqlc.GetUserPreferencesRow{}, s.readErr
}

// SaveUserPreferences allows statement errors and no-row conflicts to be tested independently.
func (s *preferenceFaultStore) SaveUserPreferences(context.Context, sqlc.SaveUserPreferencesParams) (sqlc.SaveUserPreferencesRow, error) {
	s.writes++
	return sqlc.SaveUserPreferencesRow{}, s.writeErr
}

// TestPreferencesServiceDatabaseErrors preserves infrastructure failures and classifies no-row write results.
func TestPreferencesServiceDatabaseErrors(t *testing.T) {
	failure := errors.New("database disconnected")
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000888", GroupKey: "user"}
	for _, tc := range []struct {
		name                    string
		readErr, writeErr, want error
		update                  bool
	}{
		{"read database error", failure, nil, failure, false},
		{"read no eligible user", pgx.ErrNoRows, nil, ErrPermissionDenied, false},
		{"write database error", nil, failure, failure, true},
		{"write unauthorized", pgx.ErrNoRows, pgx.ErrNoRows, ErrPermissionDenied, true},
		{"conflict classification failed", failure, pgx.ErrNoRows, failure, true},
		{"write conflict", nil, pgx.ErrNoRows, ErrPreferencesConflict, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &preferenceFaultStore{readErr: tc.readErr, writeErr: tc.writeErr}
			service := &PreferencesService{store: store}
			var err error
			if tc.update {
				_, err = service.Update(t.Context(), actor, UpdatePreferencesInput{})
			} else {
				_, err = service.Get(t.Context(), actor)
			}
			if !errors.Is(err, tc.want) {
				t.Fatalf("error=%v want %v", err, tc.want)
			}
		})
	}
}

// TestPreferencesServiceInputValidation rejects invalid enums and versions before executing a write.
func TestPreferencesServiceInputValidation(t *testing.T) {
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000888", GroupKey: "user"}
	value := "bad"
	for _, input := range []UpdatePreferencesInput{{Language: &value}, {Theme: &value}, {ExpectedUpdatedAt: &value}} {
		store := &preferenceFaultStore{}
		if _, err := (&PreferencesService{store: store}).Update(t.Context(), actor, input); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("input=%#v error=%v", input, err)
		}
		if store.reads != 0 || store.writes != 0 {
			t.Fatal("invalid input reached the database")
		}
	}
}
