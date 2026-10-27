package usergroup

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// writerReadFailure models only database read failures, leaving real lock/security tests to PostgreSQL.
type writerReadFailure struct {
	userErr, adminErr error
	grants            []byte
}

// LockDomainPreferenceUser exposes a controlled SQL failure or the persisted actor's group ID.
func (f writerReadFailure) LockDomainPreferenceUser(context.Context, pgtype.UUID) (sqlc.LockDomainPreferenceUserRow, error) {
	return sqlc.LockDomainPreferenceUserRow{}, f.userErr
}

// LockGroupDefaultAdmin returns the raw locked permission document without a fabricated authorization result.
func (f writerReadFailure) LockGroupDefaultAdmin(context.Context, pgtype.UUID) (sqlc.UserGroup, error) {
	return sqlc.UserGroup{Key: "admin", Permissions: f.grants}, f.adminErr
}

// Catches infrastructure failures being misreported as permission denial or permissive fallback.
func TestPermissionWriterReadFailures(t *testing.T) {
	databaseFailure := errors.New("controlled database failure")
	for _, scenario := range []struct {
		name string
		q    writerReadFailure
		want error
	}{
		{"missing actor", writerReadFailure{userErr: pgx.ErrNoRows}, ErrPermissionDenied},
		{"actor read failure", writerReadFailure{userErr: databaseFailure}, databaseFailure},
		{"missing admin group", writerReadFailure{adminErr: pgx.ErrNoRows}, ErrPermissionDenied},
		{"group read failure", writerReadFailure{adminErr: databaseFailure}, databaseFailure},
		{"corrupt permissions", writerReadFailure{grants: []byte(`{"invalid":true}`)}, nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			row, err := authorizeGroupWriter(t.Context(), scenario.q, pgtype.UUID{}, false)
			require.Error(t, err)
			if scenario.want != nil {
				require.ErrorIs(t, err, scenario.want)
			} else {
				require.NotErrorIs(t, err, ErrPermissionDenied)
			}
			require.Empty(t, row)
		})
	}
}

// Catches accidentally requiring the new domain permission for legacy permission writes.
func TestPermissionWriterLegacyAndDomainPermissionScopes(t *testing.T) {
	q := writerReadFailure{grants: []byte(`["admin:access"]`)}
	row, err := authorizeGroupWriter(t.Context(), q, pgtype.UUID{}, false)
	require.NoError(t, err)
	require.Equal(t, "admin", row.Key)
	_, err = authorizeGroupWriter(t.Context(), q, pgtype.UUID{}, true)
	require.ErrorIs(t, err, ErrPermissionDenied)
	q.grants = []byte(`["admin:access","domain:manage"]`)
	_, err = authorizeGroupWriter(t.Context(), q, pgtype.UUID{}, true)
	require.NoError(t, err)
}

// Catches ambiguous actor IDs reaching audit setup or a pool before they are denied.
func TestPermissionWriterRejectsInvalidActor(t *testing.T) {
	for _, id := range []string{"", "actor-id", "00000000-0000-0000-0000-000000000000", "A3456789-1234-1234-1234-123456789012"} {
		_, err := NewService(nil, permission.NewService()).UpdatePermissions(t.Context(), auth.CurrentUser{ID: id, GroupKey: "admin"}, UpdatePermissionsInput{
			GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: "2026-10-27T01:02:03Z",
		})
		require.ErrorIs(t, err, ErrPermissionDenied)
	}
}

// Catches cancellation during any prefix/target wait leaking a write, audit, or open transaction.
func TestPermissionWriterLockCancellation(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		query string
	}{
		{"domain", `select pg_advisory_xact_lock($1)`},
		{"actor", `select id from app_user where username='writer' for update`},
		{"admin", `select id from user_group where key='admin' for no key update`},
		{"target", `select id from user_group where key='user' for no key update`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			s, pool, actor, input := permissionWriterFixture(t)
			gate, err := pool.Begin(t.Context())
			require.NoError(t, err)
			t.Cleanup(func() { _ = gate.Rollback(context.Background()) })
			if scenario.name == "domain" {
				_, err = gate.Exec(t.Context(), scenario.query, int64(0x6d6f6575726c444d))
			} else {
				_, err = gate.Exec(t.Context(), scenario.query)
			}
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			result := make(chan error, 1)
			go func() {
				_, err := s.UpdatePermissions(ctx, actor, input)
				result <- err
			}()
			waitForPermissionWriterLock(t, t.Context(), pool)
			cancel()
			require.Error(t, <-result)
			require.NoError(t, gate.Rollback(t.Context()))
			assertPermissionTargetUnchanged(t, pool)
		})
	}
}

// Catches an absent target being classified as stale or silently recreated.
func TestPermissionWriterMissingTarget(t *testing.T) {
	s, pool, actor, input := permissionWriterFixture(t)
	_, err := pool.Exec(t.Context(), `delete from user_group where key='user'`)
	require.NoError(t, err)
	_, err = s.UpdatePermissions(t.Context(), actor, input)
	require.ErrorIs(t, err, ErrUserGroupNotFound)
}
