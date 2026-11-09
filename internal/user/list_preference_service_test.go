package user_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func listPreferenceFixture(t *testing.T) (*user.ListPreferenceService, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser) {
	t.Helper()
	pool := userTestPool(t, t.Context())
	for _, key := range []string{"user", "admin", "guest"} {
		insertUserGroup(t, t.Context(), pool, key, nil)
	}
	_, err := pool.Exec(t.Context(), `update user_group set builtin=true`)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "list-owner", "hash", "Owner", "user", "active", false), GroupKey: "user"}
	other := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "list-other", "hash", "Other", "admin", "active", false), GroupKey: "admin"}
	return user.NewListPreferenceService(pool), pool, actor, other
}

// Concurrent initial and existing-version writes must each produce exactly one winner.
func TestListPreferenceExactCAS(t *testing.T) {
	s, pool, actor, other := listPreferenceFixture(t)
	var expected *string
	size := int16(50)
	for round := 0; round < 2; round++ {
		start := make(chan struct{})
		results := make(chan error, 8)
		var writers sync.WaitGroup
		for i := 0; i < 8; i++ {
			writers.Go(func() {
				<-start
				_, err := s.Update(t.Context(), actor, user.UpdateListPreferenceInput{PageSize: &size, ExpectedUpdatedAt: expected})
				results <- err
			})
		}
		close(start)
		writers.Wait()
		close(results)
		wins, conflicts := 0, 0
		for err := range results {
			if err == nil {
				wins++
			} else if errors.Is(err, user.ErrPreferencesConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		require.Equal(t, 1, wins)
		require.Equal(t, 7, conflicts)
		got, err := s.Get(t.Context(), actor)
		require.NoError(t, err)
		require.Equal(t, size, *got.Preference.PageSize)
		parsed, err := time.Parse(time.RFC3339Nano, *got.Preference.UpdatedAt)
		require.NoError(t, err)
		if expected != nil {
			old, err := time.Parse(time.RFC3339Nano, *expected)
			require.NoError(t, err)
			require.True(t, parsed.After(old))
		}
		expected = got.Preference.UpdatedAt
		nano := parsed.Add(time.Nanosecond).Format(time.RFC3339Nano)
		_, err = s.Update(t.Context(), actor, user.UpdateListPreferenceInput{ExpectedUpdatedAt: &nano})
		require.ErrorIs(t, err, user.ErrPreferencesConflict)
	}
	_, err := s.Update(t.Context(), other, user.UpdateListPreferenceInput{ExpectedUpdatedAt: expected})
	require.ErrorIs(t, err, user.ErrPreferencesConflict)
	_, err = s.Update(t.Context(), actor, user.UpdateListPreferenceInput{})
	require.ErrorIs(t, err, user.ErrPreferencesConflict)
	cleared, err := s.Update(t.Context(), actor, user.UpdateListPreferenceInput{ExpectedUpdatedAt: expected})
	require.NoError(t, err)
	require.Nil(t, cleared.Preference.PageSize)
	require.NotEqual(t, *expected, *cleared.Preference.UpdatedAt)
	firstClear, err := s.Update(t.Context(), other, user.UpdateListPreferenceInput{})
	require.NoError(t, err)
	require.Nil(t, firstClear.Preference.PageSize)
	require.NotNil(t, firstClear.Preference.UpdatedAt)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_list_preference`).Scan(&count))
	require.Equal(t, 2, count)
}

// A queued write must recheck committed account/group changes, without requiring unrelated permissions.
func TestListPreferenceCurrentAuthority(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "guest", "changed_group", "nonbuiltin", "group_guest"} {
		t.Run(change, func(t *testing.T) {
			s, pool, actor, _ := listPreferenceFixture(t)
			gate, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, gate.Rollback) }()
			statement := "LockListPreferenceUser"
			if change == "nonbuiltin" || change == "group_guest" {
				_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
				statement = "LockListPreferenceGroup"
			} else {
				_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
			}
			require.NoError(t, err)
			done := make(chan error, 1)
			go func() { _, err := s.Update(t.Context(), actor, user.UpdateListPreferenceInput{}); done <- err }()
			waitForDomainPreferenceLock(t, pool, statement)
			switch change {
			case "disabled":
				_, err = gate.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
			case "deleted":
				_, err = gate.Exec(t.Context(), `update app_user set deleted_at=clock_timestamp() where id=$1`, actor.ID)
			case "guest":
				_, err = gate.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='guest') where id=$1`, actor.ID)
			case "changed_group":
				_, err = gate.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='admin') where id=$1`, actor.ID)
			case "nonbuiltin":
				_, err = gate.Exec(t.Context(), `update user_group set builtin=false where key='user'`)
			case "group_guest":
				_, err = gate.Exec(t.Context(), `update user_group set key='retired_guest' where key='guest'; update user_group set key='guest' where key='user'`)
			}
			require.NoError(t, err)
			require.NoError(t, gate.Commit(t.Context()))
			select {
			case err := <-done:
				if change == "changed_group" {
					require.NoError(t, err)
				} else {
					require.ErrorIs(t, err, user.ErrPermissionDenied)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("released write remained blocked")
			}
			got, err := s.Get(t.Context(), actor)
			if change == "changed_group" {
				require.NoError(t, err)
				require.NotNil(t, got.Preference.UpdatedAt)
			} else {
				require.ErrorIs(t, err, user.ErrPermissionDenied)
				var count int
				require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_list_preference`).Scan(&count))
				require.Zero(t, count)
			}
		})
	}
}

func TestListPreferenceCancellationAndFailures(t *testing.T) {
	for _, failure := range []string{"account_lock", "group_lock", "begin", "account_query", "group_query", "save", "commit"} {
		t.Run(failure, func(t *testing.T) {
			s, pool, actor, _ := listPreferenceFixture(t)
			var err error
			if failure == "account_lock" || failure == "group_lock" {
				gate, err := pool.Begin(t.Context())
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, gate.Rollback) }()
				statement := "LockListPreferenceUser"
				if failure == "account_lock" {
					_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
				} else {
					_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
					statement = "LockListPreferenceGroup"
				}
				require.NoError(t, err)
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				done := make(chan error, 1)
				go func() { _, err := s.Update(ctx, actor, user.UpdateListPreferenceInput{}); done <- err }()
				waitForDomainPreferenceLock(t, pool, statement)
				cancel()
				select {
				case err := <-done:
					require.ErrorIs(t, err, context.Canceled)
				case <-time.After(5 * time.Second):
					t.Fatal("cancel did not unblock write")
				}
			} else {
				switch failure {
				case "begin":
					pool.Close()
				case "account_query":
					_, err = pool.Exec(t.Context(), `alter table app_user rename to unavailable_account`)
				case "group_query":
					_, err = pool.Exec(t.Context(), `alter table user_group rename to unavailable_group`)
				case "save":
					_, err = pool.Exec(t.Context(), `create function reject_list_write() returns trigger language plpgsql as $$ begin raise exception 'private write failure'; end $$; create trigger reject_list_write before insert on user_list_preference for each row execute function reject_list_write()`)
				case "commit":
					_, err = pool.Exec(t.Context(), `create function reject_list_commit() returns trigger language plpgsql as $$ begin raise exception 'private deferred failure'; end $$; create constraint trigger reject_list_commit after insert on user_list_preference deferrable initially deferred for each row execute function reject_list_commit()`)
				}
				require.NoError(t, err)
				size := int16(100)
				result, err := s.Update(t.Context(), actor, user.UpdateListPreferenceInput{PageSize: &size})
				require.Error(t, err)
				require.Nil(t, result.Preference.PageSize)
				require.Nil(t, result.Preference.UpdatedAt)
			}
			if failure == "begin" || failure == "account_query" || failure == "group_query" {
				_, err := s.Get(t.Context(), actor)
				require.Error(t, err)
				return
			}
			got, err := s.Get(t.Context(), actor)
			require.NoError(t, err)
			require.Nil(t, got.Preference.PageSize)
			require.Nil(t, got.Preference.UpdatedAt)
		})
	}
}

func TestListPreferenceInvalidActor(t *testing.T) {
	s, _, actor, _ := listPreferenceFixture(t)
	for _, id := range []string{"", "bad", "00000000-0000-0000-0000-000000000000", "00000000000000000000000000000391", "00000000-0000-0000-0000-000000000ABC", "00000000-0000-0000-0000-000000000391"} {
		invalid := auth.CurrentUser{ID: id, GroupKey: "user"}
		_, err := s.Get(t.Context(), invalid)
		require.ErrorIs(t, err, user.ErrPermissionDenied)
		_, err = s.Update(t.Context(), invalid, user.UpdateListPreferenceInput{})
		require.ErrorIs(t, err, user.ErrPermissionDenied)
	}
	actor.GroupKey = "guest"
	_, err := s.Get(t.Context(), actor)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = s.Update(t.Context(), actor, user.UpdateListPreferenceInput{})
	require.ErrorIs(t, err, user.ErrPermissionDenied)
}
