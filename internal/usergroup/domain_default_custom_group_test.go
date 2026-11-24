package usergroup

import (
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestGroupDefaultCustomGroupCandidatesSetAndCurrentAvailability(t *testing.T) {
	f := groupDefaultFixture(t)
	customKey := uuid.NewString()
	_, err := f.pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Operations','',$2::jsonb,false,now(),now())`, customKey, ` ["short_link:create","domain:use_default","domain:use_assigned"] `)
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id)
		select d.id,g.id from domain d cross join user_group g where d.id in ($1,$2) and g.key=$3`, f.global, f.assigned, customKey)
	require.NoError(t, err)
	memberID := uuid.NewString()
	_, err = f.pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'custom-domain-member','Member',id,'active',false,now(),now() from user_group where key=$2`, memberID, customKey)
	require.NoError(t, err)
	member := auth.CurrentUser{ID: memberID, GroupKey: customKey}

	group, err := f.s.Get(t.Context(), f.actor, customKey)
	require.NoError(t, err)
	require.Equal(t, []string{f.global, f.assigned}, []string{group.Candidates[0].ID, group.Candidates[1].ID})

	saved, err := f.s.Set(t.Context(), f.actor, f.input(t, customKey, &f.assigned))
	require.NoError(t, err)
	require.Equal(t, &f.assigned, saved.Setting.DomainID)
	current, err := f.s.GetCurrent(t.Context(), member)
	require.NoError(t, err)
	require.Equal(t, f.assigned, *current.Selection.DomainID)
	require.Equal(t, "available", current.Selection.Status)

	_, err = f.pool.Exec(t.Context(), `update user_group set permissions='[]'::jsonb where key=$1`, customKey)
	require.NoError(t, err)
	current, err = f.s.GetCurrent(t.Context(), member)
	require.NoError(t, err)
	require.Nil(t, current.Selection.DomainID)
	require.Equal(t, "unavailable", current.Selection.Status)

	var domainUpdatedAt time.Time
	require.NoError(t, f.pool.QueryRow(t.Context(), `select updated_at from domain where id=$1`, f.assigned).Scan(&domainUpdatedAt))
	domainService := domain.NewService(f.pool, permission.NewDatabaseService(f.pool))
	require.NoError(t, domainService.Delete(t.Context(), f.actor, domain.ChangeInput{
		ID: f.assigned, ExpectedUpdatedAt: domainUpdatedAt.UTC().Format(time.RFC3339Nano),
	}))
	var defaultDomain *string
	require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text from user_group where key=$1`, customKey).Scan(&defaultDomain))
	require.Nil(t, defaultDomain, "deleting a domain must clear custom-group defaults too")
}
