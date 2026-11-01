package user_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func redirectPreferenceFixture(t *testing.T) (*user.RedirectPreferenceService, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser) {
	t.Helper()
	pool := userTestPool(t, t.Context())
	insertUserGroup(t, t.Context(), pool, "user", []string{permission.ShortLinkUseIntermediate, permission.ShortLinkUseConfirmation})
	insertUserGroup(t, t.Context(), pool, "admin", nil)
	insertUserGroup(t, t.Context(), pool, "guest", nil)
	_, err := pool.Exec(t.Context(), `update user_group set builtin=true`)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "redirect-owner", "hash", "Owner", "user", "active", false), GroupKey: "user"}
	other := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "redirect-other", "hash", "Other", "admin", "active", false), GroupKey: "admin"}
	return user.NewRedirectPreferenceService(pool), pool, actor, other
}

// ExactCAS catches null replay, rounding, same-value stale writes and double winners.
func TestRedirectPreferenceExactCAS(t *testing.T) {
	s, pool, actor, other := redirectPreferenceFixture(t)
	var expected *string
	mode := "confirmation"
	for round := 0; round < 2; round++ {
		start := make(chan struct{})
		results := make(chan error, 8)
		var writers sync.WaitGroup
		for i := 0; i < 8; i++ {
			writers.Go(func() {
				<-start
				_, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &mode, ExpectedUpdatedAt: expected})
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
		require.Equal(t, mode, *got.Preference.RedirectMode)
		require.NotNil(t, got.Preference.UpdatedAt)
		parsed, err := time.Parse(time.RFC3339Nano, *got.Preference.UpdatedAt)
		require.NoError(t, err)
		if expected != nil {
			old, err := time.Parse(time.RFC3339Nano, *expected)
			require.NoError(t, err)
			require.True(t, parsed.After(old))
		}
		expected = got.Preference.UpdatedAt
		nano := parsed.Add(time.Nanosecond).Format(time.RFC3339Nano)
		_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{ExpectedUpdatedAt: &nano})
		require.ErrorIs(t, err, user.ErrPreferencesConflict)
	}
	_, err := s.Update(t.Context(), other, user.UpdateRedirectPreferenceInput{ExpectedUpdatedAt: expected})
	require.ErrorIs(t, err, user.ErrPreferencesConflict)
	_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{})
	require.ErrorIs(t, err, user.ErrPreferencesConflict)
	cleared, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{ExpectedUpdatedAt: expected})
	require.NoError(t, err)
	require.Nil(t, cleared.Preference.RedirectMode)
	require.NotEqual(t, *expected, *cleared.Preference.UpdatedAt)
	firstClear, err := s.Update(t.Context(), other, user.UpdateRedirectPreferenceInput{})
	require.NoError(t, err)
	require.Nil(t, firstClear.Preference.RedirectMode)
	require.NotNil(t, firstClear.Preference.UpdatedAt)
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_redirect_preference`).Scan(&count))
	require.Equal(t, 2, count)
}

// CurrentAuthority proves a blocked request sees committed revocation, disablement and group changes.
func TestRedirectPreferenceCurrentAuthority(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "guest", "changed_group", "nonbuiltin", "revoke_intermediate", "revoke_confirmation"} {
		t.Run(change, func(t *testing.T) {
			s, pool, actor, _ := redirectPreferenceFixture(t)
			gate, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer func() { testdb.Rollback(t, gate.Rollback) }()
			statement := "LockRedirectPreferenceUser"
			groupChange := change == "nonbuiltin" || change == "revoke_intermediate" || change == "revoke_confirmation"
			if groupChange {
				_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
				statement = "LockRedirectPreferenceGroup"
			} else {
				_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
			}
			require.NoError(t, err)
			mode := "confirmation"
			if change == "revoke_intermediate" {
				mode = "intermediate"
			}
			done := make(chan error, 1)
			go func() {
				_, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &mode})
				done <- err
			}()
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
			default:
				_, err = gate.Exec(t.Context(), `update user_group set permissions='[]' where key='user'`)
			}
			require.NoError(t, err)
			require.NoError(t, gate.Commit(t.Context()))
			select {
			case err := <-done:
				require.ErrorIs(t, err, user.ErrPermissionDenied)
			case <-time.After(5 * time.Second):
				t.Fatal("released write remained blocked")
			}
			var count int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from user_redirect_preference`).Scan(&count))
			require.Zero(t, count)
			if change == "changed_group" || change == "revoke_intermediate" || change == "revoke_confirmation" {
				// Clearing and direct remain available without any create-mode capability.
				direct := "direct"
				saved, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &direct})
				require.NoError(t, err)
				_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{ExpectedUpdatedAt: saved.Preference.UpdatedAt})
				require.NoError(t, err)
			} else {
				_, err = s.Get(t.Context(), actor)
				require.ErrorIs(t, err, user.ErrPermissionDenied)
			}
		})
	}
}

func TestRedirectPreferenceRevokedValueReadable(t *testing.T) {
	s, pool, actor, _ := redirectPreferenceFixture(t)
	mode := "intermediate"
	saved, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &mode})
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where key='user'`)
	require.NoError(t, err)
	got, err := s.Get(t.Context(), actor)
	require.NoError(t, err)
	require.Equal(t, saved, got)
	_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &mode, ExpectedUpdatedAt: saved.Preference.UpdatedAt})
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{ExpectedUpdatedAt: saved.Preference.UpdatedAt})
	require.NoError(t, err)
}

// A canceled lock wait and a real PostgreSQL trigger failure must both roll back fully.
func TestRedirectPreferenceCancellationAndRollback(t *testing.T) {
	for _, target := range []string{"account", "group", "save"} {
		t.Run(target, func(t *testing.T) {
			s, pool, actor, _ := redirectPreferenceFixture(t)
			if target == "save" {
				_, err := pool.Exec(t.Context(), `create function reject_redirect_write() returns trigger language plpgsql as $$ begin raise exception 'controlled write failure'; end $$; create trigger reject_redirect before insert on user_redirect_preference for each row execute function reject_redirect_write()`)
				require.NoError(t, err)
				_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{})
				require.Error(t, err)
			} else {
				gate, err := pool.Begin(t.Context())
				require.NoError(t, err)
				defer func() { testdb.Rollback(t, gate.Rollback) }()
				statement := "LockRedirectPreferenceUser"
				if target == "account" {
					_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
				} else {
					_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
					statement = "LockRedirectPreferenceGroup"
				}
				require.NoError(t, err)
				ctx, cancel := context.WithCancel(t.Context())
				defer cancel()
				done := make(chan error, 1)
				go func() { _, err := s.Update(ctx, actor, user.UpdateRedirectPreferenceInput{}); done <- err }()
				waitForDomainPreferenceLock(t, pool, statement)
				cancel()
				select {
				case err := <-done:
					require.ErrorIs(t, err, context.Canceled)
				case <-time.After(5 * time.Second):
					t.Fatal("cancel did not unblock write")
				}
			}
			got, err := s.Get(t.Context(), actor)
			require.NoError(t, err)
			require.Nil(t, got.Preference.RedirectMode)
			require.Nil(t, got.Preference.UpdatedAt)
		})
	}
}
