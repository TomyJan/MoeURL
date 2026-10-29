package system

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// Persisted revisions must be usable as the next command's full CAS token;
// PostgreSQL accepts finite years outside RFC3339's four-digit range.
func TestAppearancePersistedRevisionRoundTrip(t *testing.T) {
	for _, year := range []int{-1, 10000} {
		row := sqlc.SystemSetting{Key: appearanceKey, Value: []byte(`{"accentPreset":"iris"}`), UpdatedAt: pgtype.Timestamptz{Time: time.Date(year, 1, 1, 0, 0, 0, 0, time.UTC), Valid: true}}
		_, err := storedAppearance(row)
		require.ErrorIs(t, err, ErrCorruptAppearance, "a year %d revision cannot roundtrip through a valid update", year)
	}
}

// Invalid persisted JSON must never be quietly coerced into successful copy.
func TestAppearanceStoredAndInputBoundaries(t *testing.T) {
	base := sqlc.SystemSetting{Key: appearanceKey, Value: []byte(`{"accentPreset":"iris"}`), UpdatedAt: pgtype.Timestamptz{Time: time.Now(), Valid: true}}
	for _, raw := range []string{`null`, `{}`, `[]`, `{"accentPreset":4}`, `{"accentPreset":"iris","x":true}`, `{"accentPreset":"iris"} {}`, `{"accentPreset":" iris "}`, `{"accentPreset":"unknown"}`} {
		row := base
		row.Value = []byte(raw)
		_, err := storedAppearance(row)
		require.ErrorIs(t, err, ErrCorruptAppearance)
	}
	for _, revision := range []pgtype.Timestamptz{{}, {Valid: true}, {Valid: true, InfinityModifier: pgtype.Infinity}, {Valid: true, InfinityModifier: pgtype.NegativeInfinity}} {
		row := base
		row.UpdatedAt = revision
		_, err := storedAppearance(row)
		require.ErrorIs(t, err, ErrCorruptAppearance)
	}
	base.Key = "site.name"
	_, err := storedAppearance(base)
	require.ErrorIs(t, err, ErrCorruptAppearance)
	for _, text := range []string{string([]byte{0xff}), "\n", strings.Repeat("界", 201)} {
		_, err := normalizeAppearance(text)
		require.ErrorIs(t, err, ErrInvalidAppearance)
	}
	for _, raw := range []string{"yesterday", "0001-01-01T00:00:00Z", "2026-02-31T01:02:03Z"} {
		_, err := appearanceVersion(raw)
		require.ErrorIs(t, err, ErrInvalidAppearance)
	}
}

type appearanceFaultStore struct {
	row         sqlc.SystemSetting
	failAt      string
	err         error
	permissions []byte
}

func (s *appearanceFaultStore) LockAppearanceActor(context.Context, pgtype.UUID) (pgtype.UUID, error) {
	if s.failAt == "actor" {
		return pgtype.UUID{}, s.err
	}
	return pgtype.UUID{Valid: true}, nil
}
func (s *appearanceFaultStore) LockAppearanceGroup(context.Context, pgtype.UUID) ([]byte, error) {
	if s.failAt == "group" {
		return nil, s.err
	}
	return s.permissions, nil
}
func (s *appearanceFaultStore) GetSystemSettingForUpdate(context.Context, string) (sqlc.SystemSetting, error) {
	if s.failAt == "read" {
		return sqlc.SystemSetting{}, s.err
	}
	return s.row, nil
}
func (s *appearanceFaultStore) UpdateSystemSettingValue(_ context.Context, p sqlc.UpdateSystemSettingValueParams) (sqlc.SystemSetting, error) {
	if s.failAt == "write" {
		return sqlc.SystemSetting{}, s.err
	}
	s.row.Value, s.row.UpdatedAt = p.Value, p.UpdatedAt
	return s.row, nil
}

// A failed storage stage must return no successful result. Real integration
// tests separately prove rollback, locking and one-record audit semantics.
func TestAppearanceWriteStorageFailures(t *testing.T) {
	boom := errors.New("storage unavailable")
	for _, stage := range []string{"actor", "group", "read", "write"} {
		s := &appearanceFaultStore{row: sqlc.SystemSetting{Key: appearanceKey, Value: []byte(`{"accentPreset":"iris"}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: time.Now()}}, permissions: []byte(`["admin:access","system:manage"]`), failAt: stage, err: boom}
		result, err := applyAppearance(t.Context(), s, pgtype.UUID{}, Appearance{AccentPreset: "forest"}, s.row.UpdatedAt.Time)
		require.ErrorIs(t, err, boom)
		require.Empty(t, result.UpdatedAt)
	}
	for _, raw := range []string{"", "null", "{}", `[4]`, `[]`} {
		err := authorizeAppearancePermissions([]byte(raw), nil)
		if raw == `[]` {
			require.ErrorIs(t, err, ErrSettingsPermissionDenied)
		} else {
			require.ErrorIs(t, err, ErrCorruptAppearance)
		}
	}
	require.ErrorIs(t, appearanceIdentityError(pgx.ErrNoRows), ErrSettingsPermissionDenied)
	for _, raw := range []string{"", "not-an-id", "00000000-0000-0000-0000-000000000000", "A0000000-0000-0000-0000-000000000001"} {
		_, err := appearanceActorID(raw)
		require.ErrorIs(t, err, ErrSettingsPermissionDenied)
	}
	// A future saved revision still advances monotonically by a microsecond.
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	s := &appearanceFaultStore{row: sqlc.SystemSetting{Key: appearanceKey, Value: []byte(`{"accentPreset":"iris"}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: future}}, permissions: []byte(`["admin:access","system:manage"]`)}
	result, err := applyAppearance(t.Context(), s, pgtype.UUID{}, Appearance{AccentPreset: "forest"}, future)
	require.NoError(t, err)
	require.Equal(t, future.Add(time.Microsecond).Format(time.RFC3339Nano), result.UpdatedAt)
	_, err = applyAppearance(t.Context(), s, pgtype.UUID{}, Appearance{AccentPreset: "forest"}, future.Add(time.Microsecond))
	require.NoError(t, err)
	_, err = applyAppearance(t.Context(), s, pgtype.UUID{}, Appearance{AccentPreset: "forest"}, future)
	require.ErrorIs(t, err, ErrAppearanceConflict)
}
