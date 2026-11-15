package shortlink_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkCountdownServiceStorage catches fixed-five writes, lost custom codes and replay mutations in the service package.
func TestBulkCountdownServiceStorage(t *testing.T) {
	pool, service, actor, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration","short_link:set_max_visits"]' where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithCountdownsInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateCountdownItem{
		{TargetURL: "https://example.org/a-delay77", Tags: []string{}, CustomSlug: "Team77", RedirectMode: "intermediate", IntermediateDelaySeconds: "3", MaxVisits: "1"},
		{TargetURL: "https://example.org/b-delay77", Tags: []string{}, RedirectMode: "intermediate", IntermediateDelaySeconds: "10"},
		{TargetURL: "https://example.org/c-delay77", Tags: []string{}, RedirectMode: "intermediate"},
	}}
	result, err := service.BatchCreateWithCountdowns(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, input.RequestID, result.RequestID)
	require.Equal(t, 3, result.CreatedCount)
	rows, err := pool.Query(t.Context(), `select slug,intermediate_delay_seconds from short_link order by target_url`)
	require.NoError(t, err)
	var delays []int16
	var slugs []string
	for rows.Next() {
		var slug string
		var delay int16
		require.NoError(t, rows.Scan(&slug, &delay))
		slugs = append(slugs, slug)
		delays = append(delays, delay)
	}
	require.NoError(t, rows.Err())
	rows.Close()
	require.Equal(t, []int16{3, 10, 5}, delays)
	require.Equal(t, "team77", slugs[0])
	_, err = pool.Exec(t.Context(), `update short_link set intermediate_delay_seconds=9,visits_used=1 where slug='team77'`)
	require.NoError(t, err)
	before := bulkCreateSnapshot(t, pool)
	result, err = service.BatchCreateWithCountdowns(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 3, result.CreatedCount)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	var delay int16
	var used int64
	require.NoError(t, pool.QueryRow(t.Context(), `select intermediate_delay_seconds,visits_used from short_link where slug='team77'`).Scan(&delay, &used))
	require.Equal(t, int16(9), delay)
	require.Equal(t, int64(1), used)
}
