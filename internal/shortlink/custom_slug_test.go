package shortlink_test

import (
	"context"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// customSlugInput exercises the public JSON contract, including explicit empty and null values.
func customSlugInput(t *testing.T, value any) shortlink.CreateInput {
	t.Helper()
	body, err := json.Marshal(map[string]any{"targetUrl": "https://example.com", "customSlug": value})
	require.NoError(t, err)
	var input shortlink.CreateInput
	require.NoError(t, json.Unmarshal(body, &input))
	return input
}

// TestCustomSlugWaitsForConcurrentPermissionRevocation uses PostgreSQL's lock state as the synchronization barrier.
func TestCustomSlugWaitsForConcurrentPermissionRevocation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "custom-revocation", "user", permission.UserPermissions)
	tx, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	var revokingPID int
	require.NoError(t, tx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&revokingPID))
	_, err = tx.Exec(ctx, `update user_group set permissions=permissions-'short_link:custom_slug' where key='user'`)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewService())
	input := customSlugInput(t, "revokedwhilewaiting")
	result := make(chan error, 1)
	go func() { _, err := service.Create(ctx, user, input); result <- err }()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and $1=any(pg_blocking_pids(pid)))`, revokingPID).Scan(&waiting)
		return err == nil && waiting
	}, 10*time.Second, 10*time.Millisecond)
	require.NoError(t, tx.Commit(ctx))
	select {
	case err := <-result:
		require.ErrorIs(t, err, shortlink.ErrDomainUnavailable)
	case <-ctx.Done():
		t.Fatal(ctx.Err())
	}
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link`).Scan(&count))
	require.Zero(t, count)
}

// TestCustomSlugCreation validates raw ASCII before canonicalization and reserves fixed routes.
func TestCustomSlugCreation(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "custom-owner", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	for _, test := range []struct {
		value string
		want  error
	}{
		{"", shortlink.ErrInvalidInput}, {"ab", shortlink.ErrInvalidInput},
		{strings.Repeat("a", 33), shortlink.ErrInvalidInput}, {" abC", shortlink.ErrInvalidInput},
		{"abc ", shortlink.ErrInvalidInput}, {"a-b", shortlink.ErrInvalidInput}, {"a_b", shortlink.ErrInvalidInput},
		{"a/b", shortlink.ErrInvalidInput}, {"%61bc", shortlink.ErrInvalidInput}, {"Ａbc", shortlink.ErrInvalidInput},
		{"ab\n", shortlink.ErrInvalidInput}, {"ıbc", shortlink.ErrInvalidInput}, {"Kbc", shortlink.ErrInvalidInput},
		{"LOGIN", shortlink.ErrReservedSlug}, {"icons", shortlink.ErrReservedSlug}, {"API", shortlink.ErrReservedSlug},
	} {
		t.Run(test.value, func(t *testing.T) {
			_, err := service.Create(ctx, user, customSlugInput(t, test.value))
			require.ErrorIs(t, err, test.want)
		})
	}
	for _, value := range []string{"Ab9", strings.Repeat("Z", 32)} {
		result, err := service.Create(ctx, user, customSlugInput(t, value))
		require.NoError(t, err)
		require.Equal(t, strings.ToLower(value), result.ShortLink.Slug)
		require.Equal(t, "https://go.example.com/"+strings.ToLower(value), result.ShortLink.URL)
	}
	result, err := service.Create(ctx, user, customSlugInput(t, nil))
	require.NoError(t, err)
	require.Regexp(t, `^[a-z0-9]{6}$`, result.ShortLink.Slug)
}

// TestCustomSlugPermissionRecheck prevents stale permission snapshots from authorizing writes.
func TestCustomSlugPermissionRecheck(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "custom-permission", "user", permission.UserPermissions)
	limited := shortlink.NewService(pool, permission.NewServiceWithPermissions([]string{permission.ShortLinkCreate, permission.DomainUseDefault}, permission.AdminPermissions))
	_, err := limited.Create(ctx, user, customSlugInput(t, ""))
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	_, err = limited.Create(ctx, user, customSlugInput(t, nil))
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `update user_group set permissions=permissions-'short_link:custom_slug' where key='user'`)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewService())
	_, err = service.Create(ctx, user, customSlugInput(t, "notallowed"))
	require.ErrorIs(t, err, shortlink.ErrDomainUnavailable)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where slug='notallowed'`).Scan(&count))
	require.Zero(t, count)
}

// TestCustomSlugGlobalUniqueness keeps occupied and soft-deleted slugs reserved across domains and concurrent creates.
func TestCustomSlugGlobalUniqueness(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "custom-unique", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	created, err := service.Create(ctx, user, customSlugInput(t, "unique123"))
	require.NoError(t, err)
	domainID := uuid.New().String()
	_, err = pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'other.example.com','Other','short_link',true,false,now(),now());`, domainID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) select $1,id from user_group where key='user'`, domainID)
	require.NoError(t, err)
	input := customSlugInput(t, "UNIQUE123")
	input.DomainID = &domainID
	_, err = service.Create(ctx, user, input)
	require.ErrorIs(t, err, shortlink.ErrSlugConflict)
	require.NoError(t, service.Delete(ctx, user, shortlink.DeleteInput{ID: created.ShortLink.ID}))
	_, err = service.Create(ctx, user, input)
	require.ErrorIs(t, err, shortlink.ErrSlugConflict)
	input = customSlugInput(t, "racing123")
	results := make(chan error, 8)
	start := make(chan struct{})
	var workers sync.WaitGroup
	for range 8 {
		workers.Go(func() { <-start; _, err := service.Create(ctx, user, input); results <- err })
	}
	close(start)
	workers.Wait()
	close(results)
	wins := 0
	for err := range results {
		if err == nil {
			wins++
		} else {
			require.ErrorIs(t, err, shortlink.ErrSlugConflict)
		}
	}
	require.Equal(t, 1, wins)
}
