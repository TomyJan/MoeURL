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
	_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values(gen_random_uuid(),$1,'Operations','',$2::jsonb,false,now(),now())`, groupKey, ` ["short_link:create","domain:use_assigned"] `)
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

	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: groupKey}
	availableService := domain.NewService(pool, permission.NewDatabaseService(pool))
	available, err := availableService.Available(t.Context(), actor)
	require.NoError(t, err)
	require.Len(t, available.Items, 1)
	require.Equal(t, created.ID, available.Items[0].ID)
}
