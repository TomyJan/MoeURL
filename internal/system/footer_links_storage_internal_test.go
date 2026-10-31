package system

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

type footerLinksFaultStore struct {
	row         sqlc.SystemSetting
	failAt      string
	err         error
	permissions []byte
}

func (s *footerLinksFaultStore) LockFooterLinksActor(context.Context, pgtype.UUID) (pgtype.UUID, error) {
	if s.failAt == "actor" {
		return pgtype.UUID{}, s.err
	}
	return pgtype.UUID{Valid: true}, nil
}
func (s *footerLinksFaultStore) LockFooterLinksGroup(context.Context, pgtype.UUID) ([]byte, error) {
	if s.failAt == "group" {
		return nil, s.err
	}
	return s.permissions, nil
}
func (s *footerLinksFaultStore) GetSystemSettingForUpdate(context.Context, string) (sqlc.SystemSetting, error) {
	if s.failAt == "read" {
		return sqlc.SystemSetting{}, s.err
	}
	return s.row, nil
}
func (s *footerLinksFaultStore) UpdateSystemSettingValue(_ context.Context, p sqlc.UpdateSystemSettingValueParams) (sqlc.SystemSetting, error) {
	if s.failAt == "write" {
		return sqlc.SystemSetting{}, s.err
	}
	s.row.Value, s.row.UpdatedAt = p.Value, p.UpdatedAt
	return s.row, nil
}

// Returning success after any storage error, accepting corrupt grants, or
// truncating a future revision would break these observable command results.
// Real PostgreSQL tests separately prove locking, rollback and audit semantics.
func TestFooterLinksWriteStorageFailures(t *testing.T) {
	boom := errors.New("storage unavailable")
	stamp := time.Date(2026, 10, 30, 3, 0, 0, 123456000, time.UTC)
	for _, stage := range []string{"actor", "group", "read", "write"} {
		t.Run(stage, func(t *testing.T) {
			store := &footerLinksFaultStore{row: sqlc.SystemSetting{Key: footerLinksKey, Value: []byte(`{"links":[]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: stamp}}, permissions: []byte(`["admin:access","system:manage"]`), failAt: stage, err: boom}
			result, err := applyFooterLinks(t.Context(), store, pgtype.UUID{}, FooterLinks{Links: []FooterLink{{Label: "Docs", URL: "https://example.com/"}}}, stamp)
			require.ErrorIs(t, err, boom)
			require.Equal(t, FooterLinksSettings{}, result)
		})
	}
	for _, raw := range []string{"", "null", "{}", `[4]`, `[]`} {
		err := authorizeFooterLinksPermissions([]byte(raw), nil)
		if raw == `[]` {
			require.ErrorIs(t, err, ErrSettingsPermissionDenied)
		} else {
			require.ErrorIs(t, err, ErrCorruptFooterLinks)
		}
	}
	for _, raw := range []string{"", "not-an-id", "00000000-0000-0000-0000-000000000000", "A0000000-0000-0000-0000-000000000001"} {
		_, err := footerLinksActorID(raw)
		require.ErrorIs(t, err, ErrSettingsPermissionDenied)
	}
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	store := &footerLinksFaultStore{row: sqlc.SystemSetting{Key: footerLinksKey, Value: []byte(`{"links":[]}`), UpdatedAt: pgtype.Timestamptz{Valid: true, Time: future}}, permissions: []byte(`["admin:access","system:manage"]`)}
	content := FooterLinks{Links: []FooterLink{{Label: "Docs", URL: "https://example.com/"}}}
	result, err := applyFooterLinks(t.Context(), store, pgtype.UUID{}, content, future)
	require.NoError(t, err)
	require.Equal(t, content, result.FooterLinks)
	require.Equal(t, future.Add(time.Microsecond).Format(time.RFC3339Nano), result.UpdatedAt)
	same, err := applyFooterLinks(t.Context(), store, pgtype.UUID{}, content, future.Add(time.Microsecond))
	require.NoError(t, err)
	require.Equal(t, result, same)
	stale, err := applyFooterLinks(t.Context(), store, pgtype.UUID{}, content, future)
	require.ErrorIs(t, err, ErrFooterLinksConflict)
	require.Equal(t, FooterLinksSettings{}, stale)
}

// The object's own parser must reject incomplete input and trailing values,
// even when called without the document-level syntax guard.
func TestFooterLinksJSONObjectDefensiveFailures(t *testing.T) {
	for _, raw := range []string{`{"links":[],"`, `{"links":`, `{"links":[]} {}`} {
		result, err := footerJSONObject([]byte(raw), []string{"links"})
		require.ErrorIs(t, err, ErrInvalidFooterLinks)
		require.Nil(t, result)
	}
}
