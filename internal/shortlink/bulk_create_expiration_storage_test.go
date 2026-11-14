package shortlink_test

import (
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestBulkExpirationServiceStorage catches discarded dates, stale grants and non-atomic expired batches.
func TestBulkExpirationServiceStorage(t *testing.T) {
	pool, service, actor, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration"]' where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithExpirationsInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateExpirationItem{
		{TargetURL: "https://example.org/direct75", Title: " raw ", Tags: []string{" tag "}, CustomSlug: "Team75", ExpiresAt: "2099-01-01T00:00:00Z"},
		{TargetURL: "https://example.org/intermediate75", Tags: []string{}, RedirectMode: "intermediate"},
		{TargetURL: "https://example.org/confirmation75", Tags: []string{}, RedirectMode: "confirmation", ExpiresAt: "2099-02-01T12:34:56Z"},
	}}
	for range 2 {
		result, err := service.BatchCreateWithExpirations(t.Context(), actor, input)
		require.NoError(t, err)
		require.Equal(t, 3, result.CreatedCount)
		var modes, slugs, titles, expiries []string
		rows, err := pool.Query(t.Context(), `select redirect_mode,slug,title,expires_at from short_link order by target_url`)
		require.NoError(t, err)
		for rows.Next() {
			var mode, slug, title, text string
			var expiry pgtype.Timestamptz
			require.NoError(t, rows.Scan(&mode, &slug, &title, &expiry))
			if expiry.Valid {
				text = expiry.Time.UTC().Format(time.RFC3339)
			}
			modes = append(modes, mode)
			slugs = append(slugs, slug)
			titles = append(titles, title)
			expiries = append(expiries, text)
		}
		require.NoError(t, rows.Err())
		rows.Close()
		require.Equal(t, []string{"confirmation", "direct", "intermediate"}, modes)
		require.Equal(t, []string{"2099-02-01T12:34:56Z", "2099-01-01T00:00:00Z", ""}, expiries)
		require.Equal(t, "team75", slugs[1])
		require.Equal(t, "raw", titles[1])
		var links, audits, receipts, used, unwanted int
		require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log where action='create' and resource_type='short_link'),(select count(*) from short_link_create_batch),(select used from account_daily_create_usage where actor_id=$1::uuid),(select count(*) from short_link where intermediate_delay_seconds<>5 or password_hash is not null or password_updated_at is not null or max_visits is not null)`, actor.ID).Scan(&links, &audits, &receipts, &used, &unwanted))
		require.Equal(t, []int{3, 3, 1, 3, 0}, []int{links, audits, receipts, used, unwanted})
	}
	for _, grant := range []string{"short_link:use_intermediate", "short_link:use_confirmation", "short_link:set_expiration", "short_link:create", "domain:use_default", "short_link:set_metadata", "short_link:custom_slug"} {
		_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='user'`, grant)
		require.NoError(t, err)
		before := bulkCreateSnapshot(t, pool)
		result, err := service.BatchCreateWithExpirations(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		require.Zero(t, result)
		require.Equal(t, before, bulkCreateSnapshot(t, pool))
		_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions||jsonb_build_array($1::text) where key='user'`, grant)
		require.NoError(t, err)
	}
	input.RequestID = uuid.NewString()
	input.Items[2].ExpiresAt = "2000-01-01T00:00:00Z"
	before := bulkCreateSnapshot(t, pool)
	result, err := service.BatchCreateWithExpirations(t.Context(), actor, input)
	require.ErrorIs(t, err, shortlink.ErrInvalidExpiration)
	require.Zero(t, result)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	for i := range input.Items {
		input.Items[i].ExpiresAt = ""
		input.Items[i].CustomSlug = ""
	}
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_expiration' where key='user'`)
	require.NoError(t, err)
	result, err = service.BatchCreateWithExpirations(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, 3, result.CreatedCount)
}

// TestBulkExpirationClockFailure verifies a real transaction rolls back when the database clock fails.
func TestBulkExpirationClockFailure(t *testing.T) {
	pool, _, actor, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:set_expiration"]' where key='user'; create function public.clock_timestamp() returns timestamptz language plpgsql as $$ begin raise exception 'owned_expiry_clock_failure'; end $$`)
	require.NoError(t, err)
	config := pool.Config()
	config.ConnConfig.RuntimeParams["search_path"] = "public,pg_catalog"
	failing, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	t.Cleanup(failing.Close)
	before := bulkCreateSnapshot(t, pool)
	input := shortlink.BatchCreateWithExpirationsInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateExpirationItem{{TargetURL: "https://example.org/clock75", Tags: []string{}, ExpiresAt: "2099-01-01T00:00:00Z"}}}
	result, err := shortlink.NewService(failing, permission.NewDatabaseService(failing)).BatchCreateWithExpirations(t.Context(), actor, input)
	require.ErrorContains(t, err, "owned_expiry_clock_failure")
	require.Zero(t, result)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
}
