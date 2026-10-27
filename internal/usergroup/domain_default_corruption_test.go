package usergroup

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// Catches JSON null being treated as an ordinary empty permission array and hiding corrupt configuration.
func TestGroupDefaultNullPermissionsFailClosed(t *testing.T) {
	f := groupDefaultFixture(t)
	member := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "user"}
	_, err := f.pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'null-grants','Member',id,'active',false,now(),now() from user_group where key='user'`, member.ID)
	require.NoError(t, err)
	input := f.input(t, "user", nil)
	_, err = f.pool.Exec(t.Context(), `update user_group set permissions='null'::jsonb where key='user'`)
	require.NoError(t, err)
	for _, check := range []struct {
		name string
		run  func() error
	}{
		{"management read", func() error { _, err := f.s.Get(t.Context(), f.actor, "user"); return err }},
		{"clear", func() error { _, err := f.s.Set(t.Context(), f.actor, input); return err }},
		{"self read", func() error { _, err := f.s.GetCurrent(t.Context(), member); return err }},
	} {
		t.Run(check.name, func(t *testing.T) {
			err := check.run()
			require.Error(t, err)
			require.NotErrorIs(t, err, ErrPermissionDenied)
			require.NotErrorIs(t, err, ErrInvalidInput)
		})
	}
}
