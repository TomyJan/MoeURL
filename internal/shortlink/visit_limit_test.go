package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

// TestServiceVisitLimitLifecycle checks quota periods through both management paths.
func TestServiceVisitLimitLifecycle(t *testing.T) {
	for _, administrative := range []bool{false, true} {
		name := "owner"
		if administrative {
			name = "admin"
		}
		t.Run(name, func(t *testing.T) {
			ctx := t.Context()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			actor := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
			service := shortlink.NewService(pool, permission.NewService())
			update := service.Update
			if administrative {
				actor.GroupKey = permission.GroupAdmin
				update = service.AdminUpdate
			}
			owner := actor
			owner.GroupKey = permission.GroupUser
			created, err := service.Create(ctx, owner, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(3)})
			require.NoError(t, err)
			require.Equal(t, int64(3), *created.ShortLink.MaxVisits)
			require.Zero(t, created.ShortLink.VisitsUsed)
			_, err = pool.Exec(ctx, `update short_link set visits_used = 2 where id = $1`, created.ShortLink.ID)
			require.NoError(t, err)

			for _, step := range []struct {
				name      string
				limit     *shortlink.VisitLimitInput
				max       *int64
				used      int64
				remaining *int64
				exhausted bool
			}{
				{name: "omitted preserves", max: visitMax(3), used: 2, remaining: visitMax(1)},
				{name: "reduce below usage", limit: &shortlink.VisitLimitInput{Mode: "limited", MaxVisits: visitMax(1)}, max: visitMax(1), used: 2, remaining: visitMax(0), exhausted: true},
				{name: "increase restores", limit: &shortlink.VisitLimitInput{Mode: "limited", MaxVisits: visitMax(5)}, max: visitMax(5), used: 2, remaining: visitMax(3)},
				{name: "clear resets", limit: &shortlink.VisitLimitInput{Mode: "unlimited"}},
				{name: "enable starts new period", limit: &shortlink.VisitLimitInput{Mode: "limited", MaxVisits: visitMax(2)}, max: visitMax(2), remaining: visitMax(2)},
			} {
				t.Run(step.name, func(t *testing.T) {
					result, err := update(ctx, actor, shortlink.UpdateInput{ID: created.ShortLink.ID, VisitLimit: step.limit})
					require.NoError(t, err)
					require.Equal(t, step.max, result.ShortLink.MaxVisits)
					require.Equal(t, step.used, result.ShortLink.VisitsUsed)
					require.Equal(t, step.remaining, result.ShortLink.VisitsRemaining)
					require.Equal(t, step.exhausted, result.ShortLink.Exhausted)
				})
			}
			listed, err := service.List(ctx, owner, shortlink.ListInput{})
			require.NoError(t, err)
			require.Equal(t, visitMax(2), listed.Items[0].MaxVisits)
			statistics, err := service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: created.ShortLink.ID})
			require.NoError(t, err)
			require.Equal(t, visitMax(2), statistics.ShortLink.VisitsRemaining)
			adminList, err := service.AdminList(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.ListInput{})
			require.NoError(t, err)
			require.Equal(t, visitMax(2), adminList.Items[0].MaxVisits)
		})
	}
}

// TestServiceVisitLimitValidationAndPermissions rejects malformed and unauthorized quota changes.
func TestServiceVisitLimitValidationAndPermissions(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", permission.GroupUser, permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	created, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	require.NoError(t, err)
	require.Nil(t, created.ShortLink.MaxVisits)
	require.Nil(t, created.ShortLink.VisitsRemaining)
	for _, max := range []int64{0, -1, 2147483648} {
		_, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: &max})
		require.ErrorIs(t, err, shortlink.ErrInvalidVisitLimit)
	}
	for _, limit := range []*shortlink.VisitLimitInput{
		{Mode: ""}, {Mode: "keep"}, {Mode: "limited"},
		{Mode: "limited", MaxVisits: visitMax(0)}, {Mode: "limited", MaxVisits: visitMax(2147483648)},
		{Mode: "unlimited", MaxVisits: visitMax(1)},
	} {
		_, err := service.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, VisitLimit: limit})
		require.ErrorIs(t, err, shortlink.ErrInvalidVisitLimit)
	}
	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(2147483647)})
	require.NoError(t, err)

	limited := shortlink.NewService(pool, permission.NewServiceWithPermissions(
		removePermission(permission.UserPermissions, permission.ShortLinkSetMaxVisits),
		removePermission(permission.AdminPermissions, permission.ShortLinkSetMaxVisits),
	))
	_, err = limited.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com", MaxVisits: visitMax(1)})
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	for _, input := range []*shortlink.VisitLimitInput{{Mode: "limited", MaxVisits: visitMax(1)}, {Mode: "unlimited"}} {
		_, err = limited.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, VisitLimit: input})
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = limited.AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, shortlink.UpdateInput{ID: created.ShortLink.ID, VisitLimit: input})
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	_, err = limited.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: ptr("https://example.com/updated")})
	require.NoError(t, err)
}

// visitMax creates optional integer inputs without sharing mutable state.
func visitMax(value int64) *int64 { return &value }
