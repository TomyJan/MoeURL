package usergroup

import (
	"context"
	"errors"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// defaultStoreFault replaces only one database failure inside otherwise real snapshot/write transactions.
type defaultStoreFault struct {
	groupDefaultStore
	operation string
	failure   error
}

// GetGroupDefaultReadActor models a failed identity read without substituting a granted permission set.
func (f defaultStoreFault) GetGroupDefaultReadActor(ctx context.Context, id pgtype.UUID) ([]byte, error) {
	if f.operation == "actor-read" {
		return nil, f.failure
	}
	return f.groupDefaultStore.GetGroupDefaultReadActor(ctx, id)
}

// GetUserGroupByKey models a target read failure in the actual management snapshot.
func (f defaultStoreFault) GetUserGroupByKey(ctx context.Context, key string) (sqlc.UserGroup, error) {
	if f.operation == "target-read" {
		return sqlc.UserGroup{}, f.failure
	}
	return f.groupDefaultStore.GetUserGroupByKey(ctx, key)
}

// LockGroupDefaultTarget models an infrastructure failure after current-account authorization.
func (f defaultStoreFault) LockGroupDefaultTarget(ctx context.Context, key string) (sqlc.UserGroup, error) {
	if f.operation == "target-lock" {
		return sqlc.UserGroup{}, f.failure
	}
	return f.groupDefaultStore.LockGroupDefaultTarget(ctx, key)
}

// GetGrantedDomainPreference keeps domain/grant errors distinct from an ordinary unavailable target.
func (f defaultStoreFault) GetGrantedDomainPreference(ctx context.Context, input sqlc.GetGrantedDomainPreferenceParams) (pgtype.UUID, error) {
	if f.operation == "grant" {
		return pgtype.UUID{}, f.failure
	}
	return f.groupDefaultStore.GetGrantedDomainPreference(ctx, input)
}

// SetUserGroupDefaultDomain models a conditional miss independently of audit-trigger failures.
func (f defaultStoreFault) SetUserGroupDefaultDomain(ctx context.Context, input sqlc.SetUserGroupDefaultDomainParams) (sqlc.UserGroup, error) {
	if f.operation == "set" {
		return sqlc.UserGroup{}, f.failure
	}
	return f.groupDefaultStore.SetUserGroupDefaultDomain(ctx, input)
}

// ListGroupDefaultCandidates can fail after a real update, proving the containing transaction rolls back.
func (f defaultStoreFault) ListGroupDefaultCandidates(ctx context.Context, input sqlc.ListGroupDefaultCandidatesParams) ([]sqlc.ListGroupDefaultCandidatesRow, error) {
	if f.operation == "candidates" {
		return nil, f.failure
	}
	return f.groupDefaultStore.ListGroupDefaultCandidates(ctx, input)
}

// GetCurrentGroupDefaultDomain models a failed self snapshot, never an invented not_set result.
func (f defaultStoreFault) GetCurrentGroupDefaultDomain(ctx context.Context, id pgtype.UUID) (sqlc.GetCurrentGroupDefaultDomainRow, error) {
	if f.operation == "current" {
		return sqlc.GetCurrentGroupDefaultDomainRow{}, f.failure
	}
	return f.groupDefaultStore.GetCurrentGroupDefaultDomain(ctx, id)
}

// Catches infrastructure errors being downgraded, partial representations, and readback failure committing a write.
func TestGroupDefaultStoreFailures(t *testing.T) {
	databaseFailure := errors.New("controlled store failure")
	for _, scenario := range []struct {
		operation     string
		write         bool
		failure, want error
	}{
		{"actor-read", false, databaseFailure, databaseFailure},
		{"actor-read", false, pgx.ErrNoRows, ErrPermissionDenied},
		{"target-read", false, databaseFailure, databaseFailure},
		{"target-read", false, pgx.ErrNoRows, ErrUserGroupNotFound},
		{"candidates", false, databaseFailure, databaseFailure},
		{"target-lock", true, databaseFailure, databaseFailure},
		{"grant", true, databaseFailure, databaseFailure},
		{"set", true, pgx.ErrNoRows, ErrPermissionConflict},
		{"candidates", true, databaseFailure, databaseFailure},
	} {
		t.Run(scenario.operation+map[bool]string{true: "-write", false: "-read"}[scenario.write]+scenario.failure.Error(), func(t *testing.T) {
			f := groupDefaultFixture(t)
			read, write := f.s.inRead, f.s.inWrite
			f.s.inRead = func(ctx context.Context, fn func(groupDefaultStore) error) error {
				return read(ctx, func(q groupDefaultStore) error { return fn(defaultStoreFault{q, scenario.operation, scenario.failure}) })
			}
			f.s.inWrite = func(ctx context.Context, actor string, fn func(groupDefaultStore, pgx.Tx) error) error {
				return write(ctx, actor, func(q groupDefaultStore, tx pgx.Tx) error {
					return fn(defaultStoreFault{q, scenario.operation, scenario.failure}, tx)
				})
			}
			var result DomainDefaultResult
			var err error
			if scenario.write {
				result, err = f.s.Set(t.Context(), f.actor, f.input(t, "user", &f.assigned))
			} else {
				result, err = f.s.Get(t.Context(), f.actor, "user")
			}
			require.ErrorIs(t, err, scenario.want)
			require.Empty(t, result)
			var selected *string
			var audits int
			require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text from user_group where key='user'`).Scan(&selected))
			require.Nil(t, selected)
			require.NoError(t, f.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
	f := groupDefaultFixture(t)
	f.s.store = defaultStoreFault{groupDefaultStore: f.s.store, operation: "current", failure: databaseFailure}
	result, err := f.s.GetCurrent(t.Context(), f.actor)
	require.ErrorIs(t, err, databaseFailure)
	require.Empty(t, result)
}

// Catches malformed public inputs reaching a database and noneditable groups becoming writable.
func TestGroupDefaultInputBoundaries(t *testing.T) {
	s := NewDomainDefaultService(nil)
	actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000002899"}
	for _, input := range []SetDomainDefaultInput{
		{GroupKey: "team", ExpectedUpdatedAt: "2026-10-27T01:02:03Z"},
		{GroupKey: "user", ExpectedUpdatedAt: "not-a-version"},
		{GroupKey: "user", ExpectedUpdatedAt: "0001-01-01T00:00:00Z"},
		{GroupKey: "user", ExpectedUpdatedAt: "2026-10-27T01:02:03.1234560001Z"},
	} {
		_, err := s.Set(t.Context(), actor, input)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	for _, id := range []string{"", "00000000-0000-0000-0000-000000000000", "A0000000-0000-0000-0000-000000002899"} {
		_, err := s.Set(t.Context(), actor, SetDomainDefaultInput{GroupKey: "user", DomainID: &id, ExpectedUpdatedAt: "2026-10-27T01:02:03Z"})
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	_, err := s.Set(t.Context(), actor, SetDomainDefaultInput{GroupKey: "guest"})
	require.ErrorIs(t, err, ErrProtectedPermission)
	_, err = s.Get(t.Context(), actor, "team")
	require.ErrorIs(t, err, ErrInvalidInput)
	_, err = s.Get(t.Context(), auth.CurrentUser{}, "user")
	require.ErrorIs(t, err, ErrPermissionDenied)
	_, err = s.Set(t.Context(), auth.CurrentUser{}, SetDomainDefaultInput{})
	require.ErrorIs(t, err, ErrPermissionDenied)
	_, err = s.GetCurrent(t.Context(), auth.CurrentUser{})
	require.ErrorIs(t, err, ErrPermissionDenied)
}

// Catches a canceled snapshot falling back to successful empty metadata and verifies guest's read-only projection.
func TestGroupDefaultReadBoundaries(t *testing.T) {
	f := groupDefaultFixture(t)
	_, err := f.pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),'guest','Guest','[]',true,now(),now())`)
	require.NoError(t, err)
	guest, err := f.s.Get(t.Context(), f.actor, "guest")
	require.NoError(t, err)
	require.False(t, guest.Setting.Editable)
	require.Nil(t, guest.Setting.DomainID)
	require.Empty(t, guest.Candidates)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err = f.s.Get(ctx, f.actor, "user")
	require.Error(t, err)
	_, err = f.pool.Exec(t.Context(), `update user_group set builtin=false where key='user'`)
	require.NoError(t, err)
	_, err = f.s.Get(t.Context(), f.actor, "user")
	require.ErrorIs(t, err, ErrUserGroupNotFound)
	_, err = f.pool.Exec(t.Context(), `update user_group set permissions='{}' where key='admin'`)
	require.NoError(t, err)
	_, err = f.s.Get(t.Context(), f.actor, "user")
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrPermissionDenied)
	_, err = f.pool.Exec(t.Context(), `update user_group set permissions='[]' where key='admin'`)
	require.NoError(t, err)
	_, err = f.s.Get(t.Context(), f.actor, "user")
	require.ErrorIs(t, err, ErrPermissionDenied)
}
