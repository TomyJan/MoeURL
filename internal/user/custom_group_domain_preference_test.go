package user_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestCustomGroupCanSetGrantedPersonalDomainPreference(t *testing.T) {
	_, _, pool, _, _, _, assigned := domainPreferenceFixture(t)
	groupKey := uuid.NewString()
	groupID := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values($1,$2,'Operations','',$3::jsonb,false,now(),now())`, groupID, groupKey, ` ["short_link:create","domain:use_default","domain:use_assigned"] `)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) values($1,$2)`, assigned.ID, groupID)
	require.NoError(t, err)
	memberID := uuid.NewString()
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		values($1,'custom-preference-member','Member',$2,'active',false,now(),now())`, memberID, groupID)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: memberID, GroupKey: groupKey}

	result, err := user.NewDomainPreferenceService(pool).Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
	require.NoError(t, err)
	require.Equal(t, &assigned.ID, result.Preference.DomainID)
}
