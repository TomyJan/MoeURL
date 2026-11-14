package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkRedirectModeServiceStorage exercises actual mode writes and pre-replay revocation in the service package.
func TestBulkRedirectModeServiceStorage(t *testing.T) {
	pool, service, actor, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation"]' where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithRedirectModesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateRedirectModeItem{
		{TargetURL: "https://example.org/direct74", Title: " raw ", Tags: []string{" tag "}, CustomSlug: "Team74"},
		{TargetURL: "https://example.org/intermediate74", Tags: []string{}, RedirectMode: "intermediate"},
		{TargetURL: "https://example.org/confirmation74", Tags: []string{}, RedirectMode: "confirmation"},
	}}
	for range 2 {
		result, err := service.BatchCreateWithRedirectModes(t.Context(), actor, input)
		require.NoError(t, err)
		require.Equal(t, 3, result.CreatedCount)
		var modes, slugs, titles []string
		rows, err := pool.Query(t.Context(), `select redirect_mode,slug,title from short_link order by target_url`)
		require.NoError(t, err)
		for rows.Next() {
			var mode, slug, title string
			require.NoError(t, rows.Scan(&mode, &slug, &title))
			modes = append(modes, mode)
			slugs = append(slugs, slug)
			titles = append(titles, title)
		}
		require.NoError(t, rows.Err())
		rows.Close()
		require.Equal(t, []string{"confirmation", "direct", "intermediate"}, modes)
		require.Equal(t, "team74", slugs[1])
		require.Equal(t, "raw", titles[1])
		var links, audits, receipts, used, unwanted int
		require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch),(select used from account_daily_create_usage where actor_id=$1::uuid),(select count(*) from short_link where intermediate_delay_seconds<>5 or expires_at is not null or password_hash is not null or password_updated_at is not null or max_visits is not null)`, actor.ID).Scan(&links, &audits, &receipts, &used, &unwanted))
		require.Equal(t, []int{3, 3, 1, 3, 0}, []int{links, audits, receipts, used, unwanted})
	}
	for _, grant := range []string{"short_link:use_intermediate", "short_link:use_confirmation"} {
		_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='user'`, grant)
		require.NoError(t, err)
		before := bulkCreateSnapshot(t, pool)
		result, err := service.BatchCreateWithRedirectModes(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		require.Zero(t, result)
		require.Equal(t, before, bulkCreateSnapshot(t, pool))
		_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions||jsonb_build_array($1::text) where key='user'`, grant)
		require.NoError(t, err)
	}
}
