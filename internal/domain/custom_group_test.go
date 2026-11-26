package domain_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestCustomGroupCanReceiveDomainGrantAndSeeAvailableDomain(t *testing.T) {
	service, pool, admin, _ := domainFixture(t)
	groupKey := "550e8400-e29b-41d4-a716-446655440006"
	groupID := uuid.New()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values($1,$2,'Operations','',$3::jsonb,false,now(),now())`, groupID, groupKey, ` ["short_link:create","domain:use_assigned"] `)
	require.NoError(t, err)

	created, err := service.Create(t.Context(), admin, domain.CreateInput{
		Host: "https://operations.example.com", DisplayName: "Operations", AllowedGroups: []string{groupKey}, Enabled: true,
	})
	require.NoError(t, err)
	require.Equal(t, []string{groupKey}, created.AllowedGroups)

	updated, err := service.Update(t.Context(), admin, domain.UpdateInput{
		ID: created.ID, Host: created.Host, DisplayName: created.DisplayName, AllowedGroups: []string{}, Enabled: true, ExpectedUpdatedAt: created.UpdatedAt,
	})
	require.NoError(t, err)
	require.Empty(t, updated.AllowedGroups)
	updated, err = service.Update(t.Context(), admin, domain.UpdateInput{
		ID: created.ID, Host: created.Host, DisplayName: created.DisplayName, AllowedGroups: []string{groupKey}, Enabled: true, ExpectedUpdatedAt: updated.UpdatedAt,
	})
	require.NoError(t, err)
	require.Equal(t, []string{groupKey}, updated.AllowedGroups)

	actorID := uuid.New()
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Operations', $3,'active',false,now(),now())`, actorID, "operations-"+actorID.String(), groupID)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: actorID.String(), GroupKey: groupKey}
	availableService := domain.NewService(pool, permission.NewDatabaseService(pool))
	available, err := availableService.Available(t.Context(), actor)
	require.NoError(t, err)
	require.Len(t, available.Items, 1)
	require.Equal(t, created.ID, available.Items[0].ID)
}

func TestSupplementalGroupPermissionAndDomainGrantAreUnioned(t *testing.T) {
	_, pool, _, _ := domainFixture(t)
	groupID, userID := uuid.New(), uuid.New()
	groupKey := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at) values($1,$2,'Supplemental','', '["short_link:create","domain:use_assigned"]',false,now(),now())`, groupID, groupKey)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) select $1,$2,'Member',id,'active',false,now(),now() from user_group where key='user'`, userID, "supplemental-domain-"+userID.String())
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, userID, groupID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) select id,$1 from domain where is_default`, groupID)
	require.NoError(t, err)

	service := domain.NewService(pool, permission.NewDatabaseService(pool))
	available, err := service.Available(t.Context(), auth.CurrentUser{ID: userID.String(), GroupKey: "forged-cache-group"})
	require.NoError(t, err)
	require.Len(t, available.Items, 1)
}
