package shortlink_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkCreateTitlesInvalidActor catches malformed identities reaching a write transaction.
func TestBulkCreateTitlesInvalidActor(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	before := bulkCreateSnapshot(t, pool)
	input := shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/invalid-actor", Title: "title"}}}
	for _, id := range []string{"", "not-uuid", uuid.Nil.String(), "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"} {
		t.Run(id, func(t *testing.T) {
			actor := owner
			actor.ID = id
			result, err := service.BatchCreateWithTitles(t.Context(), actor, input)
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.Zero(t, result)
			require.Equal(t, before, bulkCreateSnapshot(t, pool))
		})
	}
}

// TestBulkCreateTitlesConcurrent catches duplicate batches and cross-protocol key races.
func TestBulkCreateTitlesConcurrent(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/first", Title: "　首个　"}, {TargetURL: "https://example.org/second", Title: "第二个"}}}
	start := make(chan struct{})
	done := make(chan error, 8)
	for range 8 {
		go func() {
			<-start
			result, err := service.BatchCreateWithTitles(t.Context(), owner, input)
			if err == nil && result.CreatedCount != 2 {
				err = fmt.Errorf("wrong receipt: %+v", result)
			}
			done <- err
		}()
	}
	close(start)
	for range 8 {
		require.NoError(t, <-done)
	}
	var links, audits, receipts int
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	require.Equal(t, []int{2, 2, 1}, []int{links, audits, receipts})
	before := bulkCreateSnapshot(t, pool)
	_, err = pool.Exec(t.Context(), `update domain set enabled=false`)
	require.NoError(t, err)
	result, err := service.BatchCreateWithTitles(t.Context(), owner, input)
	require.NoError(t, err, "replay must not reselect a disabled domain")
	require.Equal(t, 2, result.CreatedCount)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
	_, err = pool.Exec(t.Context(), `update domain set enabled=true`)
	require.NoError(t, err)
	key := uuid.NewString()
	start = make(chan struct{})
	done = make(chan error, 2)
	go func() {
		<-start
		_, err := service.BatchCreate(t.Context(), owner, shortlink.BatchCreateInput{RequestID: key, TargetURLs: []string{"https://example.com/race"}})
		done <- err
	}()
	go func() {
		<-start
		_, err := service.BatchCreateWithTitles(t.Context(), owner, shortlink.BatchCreateWithTitlesInput{RequestID: key, Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/race", Title: ""}}})
		done <- err
	}()
	close(start)
	a, b := <-done, <-done
	if a == nil {
		require.ErrorIs(t, b, shortlink.ErrBulkCreateConflict)
	} else {
		require.ErrorIs(t, a, shortlink.ErrBulkCreateConflict)
		require.NoError(t, b)
	}
	require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	require.Equal(t, []int{3, 3, 2}, []int{links, audits, receipts})
}

// TestBulkCreateTitlesAtomicFailure catches title rows or audits surviving a late transaction failure.
func TestBulkCreateTitlesAtomicFailure(t *testing.T) {
	for _, fault := range []string{
		`alter table short_link add constraint reject_title check(title <> 'second') not valid`,
		`create function reject_title_audit() returns trigger language plpgsql as $$ begin if exists(select 1 from short_link where id=new.resource_id::uuid and title='second') then raise exception 'owned title audit fault'; end if; return new; end $$; create trigger reject_title_audit before insert on audit_log for each row execute function reject_title_audit()`,
		`alter table short_link_create_batch add constraint reject_title_receipt check(false) not valid`,
	} {
		t.Run(fmt.Sprint(len(fault)), func(t *testing.T) {
			pool, service, owner, _ := bulkCreateFixture(t)
			_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), fault)
			require.NoError(t, err)
			before := bulkCreateSnapshot(t, pool)
			result, err := service.BatchCreateWithTitles(t.Context(), owner, shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/first", Title: "first"}, {TargetURL: "https://example.org/second", Title: "second"}}})
			require.Error(t, err)
			require.Zero(t, result)
			require.Equal(t, before, bulkCreateSnapshot(t, pool))
		})
	}
}

// TestBulkCreateTitlesWaitsForCurrentMetadataAuthority catches trusting stale grants after an actor lock wait.
func TestBulkCreateTitlesWaitsForCurrentMetadataAuthority(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`)
	require.NoError(t, err)
	input := shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/revoke", Title: ""}}}
	_, err = service.BatchCreateWithTitles(t.Context(), owner, input)
	require.NoError(t, err)
	before := bulkCreateSnapshot(t, pool)
	tx, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, owner.ID)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() { _, err := service.BatchCreateWithTitles(t.Context(), owner, input); done <- err }()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond)
	_, err = tx.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_metadata' where key='user'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(t.Context()))
	require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
	require.Equal(t, before, bulkCreateSnapshot(t, pool))
}

// TestBulkCreateTitlesBoundaries catches rune/trim mistakes, invalid raw UTF-8 and partial invalid batches.
func TestBulkCreateTitlesBoundaries(t *testing.T) {
	pool, service, owner, _ := bulkCreateFixture(t)
	_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:set_metadata"]'::jsonb where key='user'`)
	require.NoError(t, err)
	before := bulkCreateSnapshot(t, pool)
	for _, tc := range []struct {
		title string
		want  error
	}{{strings.Repeat("界", 121), shortlink.ErrInvalidInput}, {"a\nb", shortlink.ErrInvalidInput}, {"a\x00b", shortlink.ErrInvalidInput}, {string([]byte{255}), shortlink.ErrInvalidInput}} {
		result, err := service.BatchCreateWithTitles(t.Context(), owner, shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: "https://example.com/valid", Title: "valid"}, {TargetURL: "https://example.com/invalid", Title: tc.title}}})
		require.ErrorIs(t, err, tc.want)
		require.Zero(t, result)
		require.Equal(t, before, bulkCreateSnapshot(t, pool))
	}
	for _, items := range [][]shortlink.BatchCreateItem{nil, make([]shortlink.BatchCreateItem, 21), {{TargetURL: "https://example.com", Title: ""}, {TargetURL: "https://example.com", Title: ""}}} {
		_, err := service.BatchCreateWithTitles(t.Context(), owner, shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: items})
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	for i, title := range []string{"\t　" + strings.Repeat("界", 120) + "　\n", "", "\ufefftext"} {
		url := fmt.Sprintf("https://example.com/valid-%d", i)
		result, err := service.BatchCreateWithTitles(t.Context(), owner, shortlink.BatchCreateWithTitlesInput{RequestID: uuid.NewString(), Items: []shortlink.BatchCreateItem{{TargetURL: url, Title: title}}})
		require.NoError(t, err)
		require.Equal(t, 1, result.CreatedCount)
		var stored string
		require.NoError(t, pool.QueryRow(t.Context(), `select title from short_link where target_url=$1`, url).Scan(&stored))
		want := []string{strings.Repeat("界", 120), "", "\ufefftext"}[i]
		require.Equal(t, want, stored)
	}
}
