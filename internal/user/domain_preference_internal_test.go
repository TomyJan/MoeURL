package user

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type domainPreferenceFaultStore struct {
	readErr, userErr, groupErr, grantErr, saveErr error
	permissions                                   []byte
}

func (s *domainPreferenceFaultStore) GetUserDomainPreference(context.Context, pgtype.UUID) (sqlc.GetUserDomainPreferenceRow, error) {
	return sqlc.GetUserDomainPreferenceRow{}, s.readErr
}
func (s *domainPreferenceFaultStore) LockDomainPreferenceUser(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceUserRow, error) {
	return sqlc.LockDomainPreferenceUserRow{}, s.userErr
}
func (s *domainPreferenceFaultStore) LockDomainPreferenceGroup(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceGroupRow, error) {
	return sqlc.LockDomainPreferenceGroupRow{Permissions: s.permissions}, s.groupErr
}
func (s *domainPreferenceFaultStore) GetGrantedDomainPreference(context.Context, sqlc.GetGrantedDomainPreferenceParams) (pgtype.UUID, error) {
	return pgtype.UUID{}, s.grantErr
}
func (s *domainPreferenceFaultStore) SaveUserDomainPreference(context.Context, sqlc.SaveUserDomainPreferenceParams) (sqlc.SaveUserDomainPreferenceRow, error) {
	return sqlc.SaveUserDomainPreferenceRow{}, s.saveErr
}

type domainPreferenceLockTx struct {
	pgx.Tx
	err error
}

func (tx domainPreferenceLockTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, tx.err
}

// TestDomainPreferenceFailures checks fail-closed classification rather than database error text.
func TestDomainPreferenceFailures(t *testing.T) {
	failure := errors.New("controlled persistence failure")
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000701"}
	selected := "00000000-0000-0000-0000-000000000702"
	for _, tc := range []struct {
		name   string
		mutate func(*domainPreferenceFaultStore)
		lock   error
		begin  error
		want   error
	}{
		{"transaction unavailable", func(*domainPreferenceFaultStore) {}, nil, failure, failure},
		{"domain lock unavailable", func(*domainPreferenceFaultStore) {}, failure, nil, failure},
		{"account missing", func(s *domainPreferenceFaultStore) { s.userErr = pgx.ErrNoRows }, nil, nil, ErrPermissionDenied},
		{"account lookup failed", func(s *domainPreferenceFaultStore) { s.userErr = failure }, nil, nil, failure},
		{"group missing", func(s *domainPreferenceFaultStore) { s.groupErr = pgx.ErrNoRows }, nil, nil, ErrPermissionDenied},
		{"group lookup failed", func(s *domainPreferenceFaultStore) { s.groupErr = failure }, nil, nil, failure},
		{"create revoked", func(s *domainPreferenceFaultStore) { s.permissions = []byte(`[]`) }, nil, nil, ErrPermissionDenied},
		{"domain grant unavailable", func(s *domainPreferenceFaultStore) { s.grantErr = pgx.ErrNoRows }, nil, nil, ErrPermissionDenied},
		{"domain lookup failed", func(s *domainPreferenceFaultStore) { s.grantErr = failure }, nil, nil, failure},
		{"stale write", func(s *domainPreferenceFaultStore) { s.saveErr = pgx.ErrNoRows }, nil, nil, ErrPreferencesConflict},
		{"write failed", func(s *domainPreferenceFaultStore) { s.saveErr = failure }, nil, nil, failure},
		{"successful nullable result", func(*domainPreferenceFaultStore) {}, nil, nil, nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &domainPreferenceFaultStore{permissions: []byte(`["short_link:create","domain:use_default"]`)}
			tc.mutate(store)
			s := &DomainPreferenceService{store: store, inTx: func(ctx context.Context, fn func(domainPreferenceStore, pgx.Tx) error) error {
				if tc.begin != nil {
					return tc.begin
				}
				return fn(store, domainPreferenceLockTx{err: tc.lock})
			}}
			result, err := s.Update(t.Context(), actor, UpdateDomainPreferenceInput{DomainID: &selected})
			if !errors.Is(err, tc.want) || result.Preference.DomainID != nil || result.Preference.UpdatedAt != nil {
				t.Fatalf("result=%#v err=%v want=%v", result, err, tc.want)
			}
		})
	}
	for _, readErr := range []error{pgx.ErrNoRows, failure} {
		want := readErr
		if errors.Is(readErr, pgx.ErrNoRows) {
			want = ErrPermissionDenied
		}
		if _, err := (&DomainPreferenceService{store: &domainPreferenceFaultStore{readErr: readErr}}).Get(t.Context(), actor); !errors.Is(err, want) {
			t.Fatalf("read error=%v want=%v", err, want)
		}
	}
	// Corrupt stored permissions are infrastructure failure, never an empty granting set.
	bad := &domainPreferenceFaultStore{permissions: []byte(`{"bad":"permissions"}`)}
	s := &DomainPreferenceService{inTx: func(ctx context.Context, fn func(domainPreferenceStore, pgx.Tx) error) error {
		return fn(bad, domainPreferenceLockTx{})
	}}
	if _, err := s.Update(t.Context(), actor, UpdateDomainPreferenceInput{DomainID: &selected}); err == nil || errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("corrupt permissions disguised as a business result: %v", err)
	}
}

// TestDomainPreferenceInvalidInput rejects aliases, nil IDs and lossy versions before any write.
func TestDomainPreferenceInvalidInput(t *testing.T) {
	s := &DomainPreferenceService{}
	for _, id := range []string{"", "bad", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-0000-0000-000000000001"} {
		actor := auth.CurrentUser{ID: id}
		if _, err := s.Get(t.Context(), actor); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("invalid actor read: %q %v", id, err)
		}
		if _, err := s.Update(t.Context(), actor, UpdateDomainPreferenceInput{}); !errors.Is(err, ErrPermissionDenied) {
			t.Fatalf("invalid actor save: %q %v", id, err)
		}
	}
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000701"}
	for _, id := range []string{"", "bad", "00000000-0000-0000-0000-000000000000", "AAAAAAAA-0000-0000-0000-000000000001"} {
		if _, err := s.Update(t.Context(), actor, UpdateDomainPreferenceInput{DomainID: &id}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid selected domain: %q %v", id, err)
		}
	}
	for _, version := range []string{"invalid", "0001-01-01T00:00:00Z", "2026-02-30T12:00:00Z", "2026-10-20T00:00:00.1234567891Z", "2026-10-20T00:00:00,123456Z", "2026-10-20T00:00:00+24:00"} {
		if _, err := s.Update(t.Context(), actor, UpdateDomainPreferenceInput{ExpectedUpdatedAt: &version}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid version: %q %v", version, err)
		}
	}
}
