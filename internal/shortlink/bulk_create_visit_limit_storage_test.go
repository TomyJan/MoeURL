package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// TestBulkVisitLimitServiceStorage catches lost caps, replay writes, and stale cap authorization with real storage.
func TestBulkVisitLimitServiceStorage(t *testing.T) {
	pool, service, actor, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration","short_link:set_max_visits"]' where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithVisitLimitsInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateVisitLimitItem{
		{TargetURL: "https://example.org/a-cap76", Title: " raw ", Tags: []string{" tag "}, CustomSlug: "Team76", ExpiresAt: "2099-01-01T00:00:00Z", MaxVisits: "1"},
		{TargetURL: "https://example.org/b-cap76", Tags: []string{}, RedirectMode: "intermediate", MaxVisits: "2147483647"},
		{TargetURL: "https://example.org/c-cap76", Tags: []string{}, RedirectMode: "confirmation"},
	}}
	result, err := service.BatchCreateWithVisitLimits(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 3, result.CreatedCount)
	rows, err := pool.Query(t.Context(), `select slug,redirect_mode,max_visits,visits_used from short_link order by target_url`)
	require.NoError(t, err)
	var caps []pgtype.Int8
	var modes, slugs []string
	for rows.Next() {
		var slug, mode string
		var cap pgtype.Int8
		var used int64
		require.NoError(t, rows.Scan(&slug, &mode, &cap, &used))
		require.Zero(t, used)
		caps = append(caps, cap)
		modes = append(modes, mode)
		slugs = append(slugs, slug)
	}
	require.NoError(t, rows.Err())
	rows.Close()
	require.Equal(t, []pgtype.Int8{{Int64: 1, Valid: true}, {Int64: 2147483647, Valid: true}, {}}, caps)
	require.Equal(t, []string{"direct", "intermediate", "confirmation"}, modes)
	require.Equal(t, "team76", slugs[0])
	var links, audits, receipts, used int
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch),(select used from account_daily_create_usage where actor_id=$1::uuid)`, actor.ID).Scan(&links, &audits, &receipts, &used))
	require.Equal(t, []int{3, 3, 1, 3}, []int{links, audits, receipts, used})
	before := bulkCreateSnapshot(t, pool)
	result, err = service.BatchCreateWithVisitLimits(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 3, result.CreatedCount)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_max_visits' where key='user'`)
	require.NoError(t, err)
	result, err = service.BatchCreateWithVisitLimits(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.Zero(t, result)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	input.RequestID = uuid.NewString()
	for i := range input.Items {
		input.Items[i].TargetURL += "-unlimited"
		input.Items[i].CustomSlug = ""
		input.Items[i].MaxVisits = ""
	}
	result, err = service.BatchCreateWithVisitLimits(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 3, result.CreatedCount)
	var unwanted int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link where target_url like '%-unlimited' and (max_visits is not null or visits_used<>0)`).Scan(&unwanted))
	require.Zero(t, unwanted)
}
