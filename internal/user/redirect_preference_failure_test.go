package user_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

// A dependency or commit failure must not return a preference whose transaction failed.
func TestRedirectPreferenceInfrastructureFailure(t *testing.T) {
	for _, failure := range []string{"begin", "account_query", "group_query", "permissions", "commit"} {
		t.Run(failure, func(t *testing.T) {
			s, pool, actor, _ := redirectPreferenceFixture(t)
			var err error
			switch failure {
			case "begin":
				pool.Close()
			case "account_query":
				_, err = pool.Exec(t.Context(), `alter table app_user rename to unavailable_account`)
			case "group_query":
				_, err = pool.Exec(t.Context(), `alter table user_group rename to unavailable_group`)
			case "permissions":
				_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where key='user'`)
			case "commit":
				_, err = pool.Exec(t.Context(), `create function reject_redirect_commit() returns trigger language plpgsql as $$ begin raise exception 'private deferred commit failure'; end $$; create constraint trigger reject_redirect_commit after insert on user_redirect_preference deferrable initially deferred for each row execute function reject_redirect_commit()`)
			}
			require.NoError(t, err)
			mode := "confirmation"
			result, err := s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{RedirectMode: &mode})
			require.Error(t, err)
			require.Nil(t, result.Preference.RedirectMode)
			require.Nil(t, result.Preference.UpdatedAt)
			if failure == "commit" {
				got, err := s.Get(t.Context(), actor)
				require.NoError(t, err)
				require.Nil(t, got.Preference.RedirectMode)
				require.Nil(t, got.Preference.UpdatedAt)
			}
		})
	}
}

// TestRedirectPreferenceInvalidActor rejects malformed or guest identities on both read and write paths.
func TestRedirectPreferenceInvalidActor(t *testing.T) {
	s, _, actor, _ := redirectPreferenceFixture(t)
	for _, id := range []string{"", "bad", "00000000-0000-0000-0000-000000000000", "00000000000000000000000000000391", "00000000-0000-0000-0000-000000000ABC"} {
		invalid := auth.CurrentUser{ID: id, GroupKey: "user"}
		_, err := s.Get(t.Context(), invalid)
		require.ErrorIs(t, err, user.ErrPermissionDenied)
		_, err = s.Update(t.Context(), invalid, user.UpdateRedirectPreferenceInput{})
		require.ErrorIs(t, err, user.ErrPermissionDenied)
	}
	actor.GroupKey = "guest"
	_, err := s.Get(t.Context(), actor)
	require.ErrorIs(t, err, user.ErrPermissionDenied)
	_, err = s.Update(t.Context(), actor, user.UpdateRedirectPreferenceInput{})
	require.ErrorIs(t, err, user.ErrPermissionDenied)
}
