package shortlink_test

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestServiceCreateRejectsGuest verifies guests cannot create short links.
func TestServiceCreateRejectsGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)

	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Create(ctx, auth.GuestUser(), shortlink.CreateInput{TargetURL: "https://example.com"})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

// TestServiceConstructorsUseDefaultPermissions verifies nil permissions use built-in defaults.
func TestServiceConstructorsUseDefaultPermissions(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, nil)

	_, err := service.List(ctx, auth.GuestUser(), shortlink.ListInput{})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

// TestServiceCreateRejectsUnsafeTargetURL verifies unsafe targets are rejected.
func TestServiceCreateRejectsUnsafeTargetURL(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)

	service := shortlink.NewService(pool, permission.NewService())

	tests := []string{
		"javascript:alert(1)",
		"http://localhost/admin",
		"http://127.0.0.1/admin",
		"http://10.0.0.1/admin",
		"http://172.16.0.1/admin",
		"http://192.168.1.1/admin",
		"http://169.254.169.254/latest/meta-data",
		"http://[::1]/admin",
	}

	for _, targetURL := range tests {
		t.Run(targetURL, func(t *testing.T) {
			_, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: targetURL})
			if !errors.Is(err, shortlink.ErrInvalidTargetURL) {
				t.Fatalf("expected ErrInvalidTargetURL, got %v", err)
			}
		})
	}
}

// TestServiceCreateStoresShortLinkWithGeneratedSlug verifies persisted generated links.
func TestServiceCreateStoresShortLinkWithGeneratedSlug(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com/path?q=1"})
	if err != nil {
		t.Fatalf("create short link: %v", err)
	}

	if result.ShortLink.ID == "" {
		t.Fatal("expected id")
	}
	if !regexp.MustCompile(`^[a-z0-9]{6}$`).MatchString(result.ShortLink.Slug) {
		t.Fatalf("unexpected slug %q", result.ShortLink.Slug)
	}
	if result.ShortLink.URL != "https://go.example.com/"+result.ShortLink.Slug {
		t.Fatalf("unexpected short link url %q", result.ShortLink.URL)
	}
	if result.ShortLink.TargetURL != "https://example.com/path?q=1" {
		t.Fatalf("unexpected target url %q", result.ShortLink.TargetURL)
	}
	if result.ShortLink.Status != "active" {
		t.Fatalf("unexpected status %q", result.ShortLink.Status)
	}
	if result.ShortLink.RedirectMode != shortlink.RedirectModeDirect {
		t.Fatalf("unexpected redirect mode %q", result.ShortLink.RedirectMode)
	}
	if result.ShortLink.IntermediateDelaySeconds != 5 {
		t.Fatalf("unexpected intermediate delay %d", result.ShortLink.IntermediateDelaySeconds)
	}
	if result.ShortLink.ExpiresAt != nil || result.ShortLink.Expired {
		t.Fatalf("unexpected default expiration: %#v", result.ShortLink)
	}
	assertCreatedAt(t, result.ShortLink)

	var storedTarget string
	err = pool.QueryRow(ctx, `select target_url from short_link where slug = $1`, result.ShortLink.Slug).Scan(&storedTarget)
	if err != nil {
		t.Fatalf("query stored short link: %v", err)
	}
	if storedTarget != result.ShortLink.TargetURL {
		t.Fatalf("expected stored target %q, got %q", result.ShortLink.TargetURL, storedTarget)
	}
}

// TestServicePasswordConfigurationRoundTrip verifies create and update operations preserve password state safely.
func TestServicePasswordConfigurationRoundTrip(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "password-user", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())

	created, err := service.Create(ctx, user, shortlink.CreateInput{
		TargetURL: "https://example.com/protected",
		Password:  &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "correct horse"},
	})
	require.NoError(t, err)
	require.True(t, created.ShortLink.PasswordEnabled)
	encoded, err := json.Marshal(created.ShortLink)
	require.NoError(t, err)
	require.False(t, regexp.MustCompile(`(?i)password_hash|argon2`).Match(encoded))
	var storedHash string
	err = pool.QueryRow(ctx, `select password_hash from short_link where id = $1`, created.ShortLink.ID).Scan(&storedHash)
	require.NoError(t, err)
	require.True(t, auth.VerifyPassword("correct horse", storedHash))
	_, err = pool.Exec(ctx, `
		update short_link
		set password_failed_attempts = 5,
			password_window_started_at = now() - interval '1 minute',
			password_blocked_until = now() + interval '15 minutes'
		where id = $1
	`, created.ShortLink.ID)
	require.NoError(t, err)
	_, err = service.Update(ctx, user, shortlink.UpdateInput{
		ID:       created.ShortLink.ID,
		Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "updated horse"},
	})
	require.NoError(t, err)
	grant, err := shortlink.NewRedirectService(pool, nil).Unlock(ctx, created.ShortLink.Slug, "updated horse")
	require.NoError(t, err)
	require.NotEmpty(t, grant.Token)

	listed, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20})
	require.NoError(t, err)
	require.Len(t, listed.Items, 1)
	require.True(t, listed.Items[0].PasswordEnabled)
	cleared, err := service.Update(ctx, user, shortlink.UpdateInput{
		ID:       created.ShortLink.ID,
		Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeNever},
	})
	require.NoError(t, err)
	require.False(t, cleared.ShortLink.PasswordEnabled)

	admin := auth.CurrentUser{ID: user.ID, GroupKey: permission.GroupAdmin}
	adminCreated, err := service.Create(ctx, admin, shortlink.CreateInput{
		TargetURL: "https://example.com/admin-protected",
		Password:  &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "admin horse"},
	})
	require.NoError(t, err)
	require.True(t, adminCreated.ShortLink.PasswordEnabled)
	adminCleared, err := service.Update(ctx, admin, shortlink.UpdateInput{
		ID:       adminCreated.ShortLink.ID,
		Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeNever},
	})
	require.NoError(t, err)
	require.False(t, adminCleared.ShortLink.PasswordEnabled)
}

// TestServicePasswordUpdatesInvalidateExistingAccessGrants verifies both owner and admin updates revoke old grants.
func TestServicePasswordUpdatesInvalidateExistingAccessGrants(t *testing.T) {
	tests := []struct {
		name   string
		update func(context.Context, *shortlink.Service, auth.CurrentUser, shortlink.UpdateInput) (shortlink.CreateResult, error)
	}{
		{
			name: "owner update",
			update: func(ctx context.Context, service *shortlink.Service, user auth.CurrentUser, input shortlink.UpdateInput) (shortlink.CreateResult, error) {
				return service.Update(ctx, user, input)
			},
		},
		{
			name: "admin update",
			update: func(ctx context.Context, service *shortlink.Service, _ auth.CurrentUser, input shortlink.UpdateInput) (shortlink.CreateResult, error) {
				return service.AdminUpdate(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, input)
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			ctx := context.Background()
			pool := shortLinkTestPool(t, ctx)
			insertShortLinkDefaultDomain(t, ctx, pool)
			user := insertShortLinkUser(t, ctx, pool, "grant-owner", permission.GroupUser, permission.UserPermissions)
			service := shortlink.NewService(pool, permission.NewService())
			redirectService := shortlink.NewRedirectService(pool, nil)

			created, err := service.Create(ctx, user, shortlink.CreateInput{
				TargetURL: "https://example.com/protected",
				Password:  &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "correct horse"},
			})
			require.NoError(t, err)
			grant, err := redirectService.Unlock(ctx, created.ShortLink.Slug, "correct horse")
			require.NoError(t, err)

			_, err = test.update(ctx, service, user, shortlink.UpdateInput{
				ID:       created.ShortLink.ID,
				Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "updated horse"},
			})
			require.NoError(t, err)
			_, err = redirectService.Continue(ctx, created.ShortLink.Slug, grant.Token)
			require.ErrorIs(t, err, shortlink.ErrPasswordRequired)
		})
	}
}

// TestServiceCreateReturnsDatabaseAndInputErrors verifies invalid identifiers and database failures.
func TestServiceCreateReturnsDatabaseAndInputErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Create(ctx, auth.CurrentUser{ID: "bad-id", GroupKey: "user"}, shortlink.CreateInput{TargetURL: "https://example.com"})
	if err == nil {
		t.Fatal("expected owner id parse error")
	}

	pool.Close()
	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceCreateReturnsInsertError verifies insert constraint failures propagate.
func TestServiceCreateReturnsInsertError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `alter table short_link add constraint target_url_reject_all check (false)`)
	if err != nil {
		t.Fatalf("add failing constraint: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())

	_, err = service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	if err == nil {
		t.Fatal("expected insert error")
	}
}

// TestServiceOverviewReturnsOnlyOwnAggregates verifies personal overview scope and event rules.
func TestServiceOverviewReturnsOnlyOwnAggregates(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "admin", permission.AdminPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	activeLinkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	disabledLinkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice2", "https://example.com/2", "disabled", false)
	deletedLinkID := insertStoredShortLink(t, ctx, pool, user.ID, "deleted", "https://example.com/deleted", "active", true)
	otherLinkID := insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	insertStoredShortLinkVisitEvent(t, ctx, pool, activeLinkID)
	insertStoredAnalyticsVisit(t, ctx, pool, disabledLinkID, "", "", "", "current_date - interval '1 day'")
	insertStoredShortLinkVisitEvent(t, ctx, pool, deletedLinkID)
	insertStoredShortLinkVisitEvent(t, ctx, pool, otherLinkID)
	_, err := pool.Exec(ctx, `
		insert into short_link_event (id, short_link_id, event_type, created_at)
		values (gen_random_uuid(), $1, 'redirect_attempted', now())
	`, activeLinkID)
	if err != nil {
		t.Fatalf("insert non-success event: %v", err)
	}

	service := shortlink.NewService(pool, permission.NewService())
	result, err := service.Overview(ctx, user)
	if err != nil {
		t.Fatalf("get overview: %v", err)
	}
	if result.TotalLinkCount != 2 || result.ActiveLinkCount != 1 || result.VisitCount != 2 || result.TodayVisitCount != 1 {
		t.Fatalf("unexpected overview: %#v", result)
	}
}

// TestServiceOverviewRejectsMissingPermission verifies own-link read permission is required.
func TestServiceOverviewRejectsMissingPermission(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Overview(ctx, auth.GuestUser())
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

// TestServiceOverviewReturnsOwnerAndDatabaseErrors verifies invalid identities and query failures propagate.
func TestServiceOverviewReturnsOwnerAndDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Overview(ctx, auth.CurrentUser{ID: "bad-id", GroupKey: "user"})
	if err == nil {
		t.Fatal("expected owner id parse error")
	}

	pool.Close()
	_, err = service.Overview(ctx, auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000501", GroupKey: "user"})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceListReturnsOnlyOwnActiveRecords verifies ownership filtering and visit statistics.
func TestServiceListReturnsOnlyOwnActiveRecords(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	aliceActiveID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "alice2", "https://example.com/2", "disabled", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "deleted", "https://example.com/deleted", "active", true)
	insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	insertStoredShortLinkVisitEvent(t, ctx, pool, aliceActiveID)
	insertStoredShortLinkVisitEvent(t, ctx, pool, aliceActiveID)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list short links: %v", err)
	}

	if result.Total != 2 {
		t.Fatalf("expected total 2, got %d", result.Total)
	}
	if len(result.Items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(result.Items))
	}
	for _, item := range result.Items {
		assertCreatedAt(t, item)
		if item.Slug == "deleted" || item.Slug == "bob001" {
			t.Fatalf("unexpected item in list: %#v", item)
		}
		if item.URL != "https://go.example.com/"+item.Slug {
			t.Fatalf("unexpected url %q", item.URL)
		}
		if item.Slug == "alice1" {
			if item.Stats == nil {
				t.Fatal("expected statistics")
			}
			if item.Stats.VisitCount != 2 {
				t.Fatalf("expected visit count 2, got %d", item.Stats.VisitCount)
			}
			if item.Stats.TodayVisitCount != 2 {
				t.Fatalf("expected today visit count 2, got %d", item.Stats.TodayVisitCount)
			}
			if item.Stats.LastVisitedAt == nil {
				t.Fatal("expected last visited at")
			}
		}
	}
}

// TestServiceListFiltersOwnLinksByStatus verifies status filtering and validation.
func TestServiceListFiltersOwnLinksByStatus(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	insertStoredShortLink(t, ctx, pool, user.ID, "alice2", "https://example.com/2", "disabled", false)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20, Status: "disabled"})
	if err != nil {
		t.Fatalf("list disabled short links: %v", err)
	}
	if result.Total != 1 || len(result.Items) != 1 || result.Items[0].Slug != "alice2" {
		t.Fatalf("expected only disabled alice2, got %#v", result)
	}

	_, err = service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20, Status: "pending"})
	if !errors.Is(err, shortlink.ErrInvalidStatus) {
		t.Fatalf("expected ErrInvalidStatus, got %v", err)
	}
}

// TestServiceListRejectsGuest verifies guests cannot list owned links.
func TestServiceListRejectsGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.List(ctx, auth.GuestUser(), shortlink.ListInput{Page: 1, PageSize: 20})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

// TestServiceListNormalizesPaginationAndReturnsErrors verifies list bounds and failures.
func TestServiceListNormalizesPaginationAndReturnsErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.List(ctx, user, shortlink.ListInput{Page: 0, PageSize: 999})
	if err != nil {
		t.Fatalf("list short links: %v", err)
	}
	if result.Page != 1 || result.PageSize != 100 {
		t.Fatalf("expected normalized pagination, got page=%d pageSize=%d", result.Page, result.PageSize)
	}

	_, err = service.List(ctx, auth.CurrentUser{ID: "bad-id", GroupKey: "user"}, shortlink.ListInput{})
	if err == nil {
		t.Fatal("expected owner id parse error")
	}

	pool.Close()
	_, err = service.List(ctx, user, shortlink.ListInput{})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceListReturnsRowQueryError verifies malformed list queries propagate errors.
func TestServiceListReturnsRowQueryError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	_, err := pool.Exec(ctx, `alter table domain rename column host to broken_host`)
	if err != nil {
		t.Fatalf("rename domain host: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())

	_, err = service.List(ctx, user, shortlink.ListInput{})
	if err == nil {
		t.Fatal("expected row query error")
	}
}

// TestServiceUpdateOwnShortLink verifies owners can update their links.
func TestServiceUpdateOwnShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	targetURL := "https://example.org/updated"
	status := "disabled"

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.Update(ctx, user, shortlink.UpdateInput{ID: linkID, TargetURL: &targetURL, Status: &status})
	if err != nil {
		t.Fatalf("update short link: %v", err)
	}
	if result.ShortLink.TargetURL != targetURL {
		t.Fatalf("expected target url %q, got %q", targetURL, result.ShortLink.TargetURL)
	}
	if result.ShortLink.Status != "disabled" {
		t.Fatalf("expected disabled, got %q", result.ShortLink.Status)
	}
	assertCreatedAt(t, result.ShortLink)
}

// TestServiceUpdateReturnsDefaultDomainError verifies updates require the default domain.
func TestServiceUpdateReturnsDefaultDomainError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	_, err := pool.Exec(ctx, `update domain set enabled = false where is_default = true`)
	if err != nil {
		t.Fatalf("disable default domain: %v", err)
	}
	status := "disabled"
	service := shortlink.NewService(pool, permission.NewService())

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: linkID, Status: &status})
	if err == nil {
		t.Fatal("expected default domain error")
	}
}

// TestServiceUpdateRejectsInvalidInputAndForeignLink verifies validation and ownership boundaries.
func TestServiceUpdateRejectsInvalidInputAndForeignLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	foreignLinkID := insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	invalidURL := "file:///secret"
	invalidStatus := "pending"
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, Status: ptr("disabled")})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, TargetURL: &invalidURL})
	if !errors.Is(err, shortlink.ErrInvalidTargetURL) {
		t.Fatalf("expected ErrInvalidTargetURL, got %v", err)
	}

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: foreignLinkID, Status: &invalidStatus})
	if !errors.Is(err, shortlink.ErrInvalidStatus) {
		t.Fatalf("expected ErrInvalidStatus, got %v", err)
	}

	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: "bad-id", Status: ptr("disabled")})
	if err == nil {
		t.Fatal("expected link id parse error")
	}

	_, err = service.Update(ctx, auth.CurrentUser{ID: "bad-owner", GroupKey: "user"}, shortlink.UpdateInput{ID: foreignLinkID, Status: ptr("disabled")})
	if err == nil {
		t.Fatal("expected owner id parse error")
	}
}

// TestServiceUpdateRejectsPermissionAndReturnsDatabaseErrors verifies update failure paths.
func TestServiceUpdateRejectsPermissionAndReturnsDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Update(ctx, auth.GuestUser(), shortlink.UpdateInput{ID: linkID, Status: ptr("disabled")})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	pool.Close()
	_, err = service.Update(ctx, user, shortlink.UpdateInput{ID: linkID, Status: ptr("disabled")})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceDeleteOwnShortLinkSoftDeletes verifies owner deletion is soft deletion.
func TestServiceDeleteOwnShortLinkSoftDeletes(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	service := shortlink.NewService(pool, permission.NewService())

	err := service.Delete(ctx, user, shortlink.DeleteInput{ID: linkID})
	if err != nil {
		t.Fatalf("delete short link: %v", err)
	}

	var deleted bool
	err = pool.QueryRow(ctx, `select deleted_at is not null from short_link where id = $1`, linkID).Scan(&deleted)
	if err != nil {
		t.Fatalf("query deleted flag: %v", err)
	}
	if !deleted {
		t.Fatal("expected deleted_at to be set")
	}
}

// TestServiceDeleteRejectsForeignLinkAndGuest verifies delete ownership and permission checks.
func TestServiceDeleteRejectsForeignLinkAndGuest(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	other := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	foreignLinkID := insertStoredShortLink(t, ctx, pool, other.ID, "bob001", "https://example.com/bob", "active", false)
	service := shortlink.NewService(pool, permission.NewService())

	err := service.Delete(ctx, user, shortlink.DeleteInput{ID: foreignLinkID})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	err = service.Delete(ctx, auth.GuestUser(), shortlink.DeleteInput{ID: foreignLinkID})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}

	err = service.Delete(ctx, user, shortlink.DeleteInput{ID: "bad-id"})
	if err == nil {
		t.Fatal("expected link id parse error")
	}

	err = service.Delete(ctx, auth.CurrentUser{ID: "bad-owner", GroupKey: "user"}, shortlink.DeleteInput{ID: foreignLinkID})
	if err == nil {
		t.Fatal("expected owner id parse error")
	}
}

// TestServiceDeleteReturnsDatabaseError verifies delete database failures propagate.
func TestServiceDeleteReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "alice1", "https://example.com/1", "active", false)
	service := shortlink.NewService(pool, permission.NewService())
	pool.Close()

	err := service.Delete(ctx, user, shortlink.DeleteInput{ID: linkID})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceAdminListReturnsAllOwners verifies administrators see links and owners.
func TestServiceAdminListReturnsAllOwners(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	alice := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	bob := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	aliceLinkID := insertStoredShortLink(t, ctx, pool, alice.ID, "alice1", "https://example.com/1", "active", false)
	insertStoredShortLink(t, ctx, pool, bob.ID, "bob001", "https://example.com/bob", "disabled", false)
	insertStoredShortLinkVisitEvent(t, ctx, pool, aliceLinkID)

	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if result.Total != 2 || len(result.Items) != 2 {
		t.Fatalf("unexpected result: %#v", result)
	}
	owners := map[string]bool{}
	for _, item := range result.Items {
		assertCreatedAt(t, item)
		owners[item.Owner.Username] = true
	}
	if !owners["alice"] || !owners["bob"] {
		t.Fatalf("expected alice and bob owners, got %#v", owners)
	}
	for _, item := range result.Items {
		if item.Slug == "alice1" && (item.Stats == nil || item.Stats.VisitCount != 1 || item.Stats.TodayVisitCount != 1 || item.Stats.LastVisitedAt == nil) {
			t.Fatalf("unexpected statistics for alice1: %#v", item.Stats)
		}
	}
}

// TestServiceAdminListFiltersByStatusAndSearchesKeyword verifies admin filtering and search.
func TestServiceAdminListFiltersByStatusAndSearchesKeyword(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	alice := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	bob := insertShortLinkUserForGroup(t, ctx, pool, "bob", "00000000-0000-0000-0000-000000000401", "00000000-0000-0000-0000-000000000502", "user", permission.UserPermissions)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	insertStoredShortLink(t, ctx, pool, alice.ID, "alice1", "https://example.com/one", "active", false)
	insertStoredShortLink(t, ctx, pool, bob.ID, "bob002", "https://example.org/two", "disabled", false)

	service := shortlink.NewService(pool, permission.NewService())

	disabled, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20, Status: "disabled"})
	if err != nil {
		t.Fatalf("admin list disabled: %v", err)
	}
	if disabled.Total != 1 || len(disabled.Items) != 1 || disabled.Items[0].Slug != "bob002" {
		t.Fatalf("expected disabled bob002, got %#v", disabled)
	}

	searched, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20, Query: "alice"})
	if err != nil {
		t.Fatalf("admin search alice: %v", err)
	}
	if searched.Total != 1 || len(searched.Items) != 1 || searched.Items[0].Owner.Username != "alice" {
		t.Fatalf("expected alice search result, got %#v", searched)
	}

	_, err = service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20, Status: "pending"})
	if !errors.Is(err, shortlink.ErrInvalidStatus) {
		t.Fatalf("expected ErrInvalidStatus, got %v", err)
	}
}

// TestServiceAdminOperationsRequirePermissions verifies all admin link operations require permissions.
func TestServiceAdminOperationsRequirePermissions(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())
	regular := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", Username: "bob", GroupKey: "user"}

	_, err := service.AdminList(ctx, regular, shortlink.ListInput{})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
	err = service.AdminDelete(ctx, regular, shortlink.DeleteInput{ID: "00000000-0000-0000-0000-000000000701"})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
	_, err = service.AdminUpdate(ctx, regular, shortlink.UpdateInput{ID: "00000000-0000-0000-0000-000000000701"})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected ErrPermissionDenied, got %v", err)
	}
}

// TestServiceAdminUpdateAndDeleteAnyShortLink verifies administrators can mutate any link.
func TestServiceAdminUpdateAndDeleteAnyShortLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "alice1", "https://example.com/1", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	status := "disabled"
	service := shortlink.NewService(pool, permission.NewService())

	updated, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, Status: &status})
	if err != nil {
		t.Fatalf("admin update: %v", err)
	}
	if updated.ShortLink.Status != "disabled" {
		t.Fatalf("expected disabled, got %q", updated.ShortLink.Status)
	}
	assertCreatedAt(t, updated.ShortLink)

	err = service.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: linkID})
	if err != nil {
		t.Fatalf("admin delete: %v", err)
	}
	var deleted bool
	err = pool.QueryRow(ctx, `select deleted_at is not null from short_link where id = $1`, linkID).Scan(&deleted)
	if err != nil {
		t.Fatalf("query deleted flag: %v", err)
	}
	if !deleted {
		t.Fatal("expected deleted_at")
	}
}

// TestServiceAdminUpdateReturnsDefaultDomainError verifies admin updates require the default domain.
func TestServiceAdminUpdateReturnsDefaultDomainError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "alice1", "https://example.com/1", "active", false)
	_, err := pool.Exec(ctx, `update domain set enabled = false where is_default = true`)
	if err != nil {
		t.Fatalf("disable default domain: %v", err)
	}
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	status := "disabled"
	service := shortlink.NewService(pool, permission.NewService())

	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, Status: &status})
	if err == nil {
		t.Fatal("expected default domain error")
	}
}

// TestServiceAdminListNormalizesPaginationAndReturnsDatabaseError verifies admin list bounds and failures.
func TestServiceAdminListNormalizesPaginationAndReturnsDatabaseError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: -1, PageSize: -1})
	if err != nil {
		t.Fatalf("admin list: %v", err)
	}
	if result.Page != 1 || result.PageSize != 20 {
		t.Fatalf("expected normalized pagination, got page=%d pageSize=%d", result.Page, result.PageSize)
	}

	pool.Close()
	_, err = service.AdminList(ctx, admin, shortlink.ListInput{})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceAdminListReturnsRowQueryError verifies admin row query failures propagate.
func TestServiceAdminListReturnsRowQueryError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	_, err := pool.Exec(ctx, `alter table domain rename column host to broken_host`)
	if err != nil {
		t.Fatalf("rename domain host: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())

	_, err = service.AdminList(ctx, admin, shortlink.ListInput{})
	if err == nil {
		t.Fatal("expected row query error")
	}
}

// TestServiceAdminUpdateRejectsInvalidInputAndReturnsErrors verifies admin update validation.
func TestServiceAdminUpdateRejectsInvalidInputAndReturnsErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "alice1", "https://example.com/1", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := shortlink.NewService(pool, permission.NewService())
	invalidURL := "file:///secret"
	invalidStatus := "pending"

	_, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, TargetURL: &invalidURL})
	if !errors.Is(err, shortlink.ErrInvalidTargetURL) {
		t.Fatalf("expected ErrInvalidTargetURL, got %v", err)
	}

	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, Status: &invalidStatus})
	if !errors.Is(err, shortlink.ErrInvalidStatus) {
		t.Fatalf("expected ErrInvalidStatus, got %v", err)
	}

	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: "bad-id", Status: ptr("disabled")})
	if err == nil {
		t.Fatal("expected id parse error")
	}

	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: "00000000-0000-0000-0000-000000009999", Status: ptr("disabled")})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	pool.Close()
	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, Status: ptr("disabled")})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceAdminDeleteReturnsInputMissingAndDatabaseErrors verifies admin delete failure paths.
func TestServiceAdminDeleteReturnsInputMissingAndDatabaseErrors(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "alice1", "https://example.com/1", "active", false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: "admin"}
	service := shortlink.NewService(pool, permission.NewService())

	err := service.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: "bad-id"})
	if err == nil {
		t.Fatal("expected id parse error")
	}

	err = service.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: "00000000-0000-0000-0000-000000009999"})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected ErrShortLinkMissing, got %v", err)
	}

	pool.Close()
	err = service.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: linkID})
	if err == nil {
		t.Fatal("expected database error")
	}
}

// TestServiceStatisticsReturnsOwnedLinkAnalytics verifies owners receive summary, trend, and dimensions.
func TestServiceStatisticsReturnsOwnedLinkAnalytics(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "stats1", "https://example.com/1", "active", false)
	insertStoredAnalyticsVisit(t, ctx, pool, linkID, "search.example", "mobile", "CN", "now()")
	insertStoredAnalyticsVisit(t, ctx, pool, linkID, "", "desktop", "US", "now() - interval '2 days'")
	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: linkID})
	if err != nil {
		t.Fatalf("statistics: %v", err)
	}
	if result.ShortLink.ID != linkID || result.Stats.VisitCount != 2 || result.Stats.TodayVisitCount != 1 || len(result.Stats.Trend) != 7 {
		t.Fatalf("unexpected statistics: %#v", result)
	}
	assertCreatedAt(t, result.ShortLink)
	if len(result.Stats.Referrers) != 2 || result.Stats.Referrers[0].Value != "search.example" {
		t.Fatalf("unexpected referrers: %#v", result.Stats.Referrers)
	}
	if len(result.Stats.Devices) != 2 || len(result.Stats.Countries) != 2 {
		t.Fatalf("unexpected dimensions: %#v", result.Stats)
	}
}

// TestServiceStatisticsEnforcesVisibilityAndInput verifies statistics errors do not disclose other links.
func TestServiceStatisticsEnforcesVisibilityAndInput(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "stats2", "https://example.com/2", "active", false)
	other := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000602", GroupKey: "user"}
	service := shortlink.NewService(pool, permission.NewService())

	_, err := service.Statistics(ctx, other, shortlink.StatisticsInput{ID: linkID})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected missing link, got %v", err)
	}
	_, err = service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: "bad-id"})
	if !errors.Is(err, shortlink.ErrInvalidShortLinkID) {
		t.Fatalf("expected invalid id, got %v", err)
	}
	_, err = service.AdminStatistics(ctx, other, shortlink.StatisticsInput{ID: linkID})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected permission denied, got %v", err)
	}
	_, err = service.Statistics(ctx, auth.GuestUser(), shortlink.StatisticsInput{ID: linkID})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected owner permission denied, got %v", err)
	}
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", GroupKey: "admin"}
	_, err = service.AdminStatistics(ctx, admin, shortlink.StatisticsInput{ID: "bad-id"})
	if !errors.Is(err, shortlink.ErrInvalidShortLinkID) {
		t.Fatalf("expected admin invalid id, got %v", err)
	}
	_, err = service.AdminStatistics(ctx, admin, shortlink.StatisticsInput{ID: "00000000-0000-0000-0000-000000009999"})
	if !errors.Is(err, shortlink.ErrShortLinkMissing) {
		t.Fatalf("expected admin missing link, got %v", err)
	}
	pool.Close()
	_, err = service.Statistics(ctx, owner, shortlink.StatisticsInput{ID: linkID})
	if err == nil {
		t.Fatal("expected analytics database error")
	}
}

// TestServiceAdminStatisticsReturnsAnyVisibleLink verifies administrators can read cross-owner analytics.
func TestServiceAdminStatisticsReturnsAnyVisibleLink(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	owner := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	linkID := insertStoredShortLink(t, ctx, pool, owner.ID, "stats3", "https://example.com/3", "active", false)
	insertStoredAnalyticsVisit(t, ctx, pool, linkID, "", "mobile", "", "now()")
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", GroupKey: "admin"}
	service := shortlink.NewService(pool, permission.NewService())

	result, err := service.AdminStatistics(ctx, admin, shortlink.StatisticsInput{ID: linkID})
	if err != nil || result.Stats.VisitCount != 1 {
		t.Fatalf("admin statistics = %#v, %v", result, err)
	}
}

// TestServiceAccessConfigCreateListAndUpdate verifies access settings persist across every owner mutation path.
func TestServiceAccessConfigCreateListAndUpdate(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	future := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)

	created, err := service.Create(ctx, user, shortlink.CreateInput{
		TargetURL:                "https://example.com/docs",
		RedirectMode:             shortlink.RedirectModeIntermediate,
		IntermediateDelaySeconds: 7,
		Expiration: &shortlink.ExpirationInput{
			Mode:      shortlink.ExpirationModeAt,
			ExpiresAt: &future,
		},
	})
	if err != nil {
		t.Fatalf("create configured short link: %v", err)
	}
	assertAccessConfig(t, created.ShortLink, shortlink.RedirectModeIntermediate, 7, &future, false)

	listed, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list configured short link: %v", err)
	}
	if len(listed.Items) != 1 {
		t.Fatalf("expected one configured link, got %#v", listed.Items)
	}
	assertAccessConfig(t, listed.Items[0], shortlink.RedirectModeIntermediate, 7, &future, false)

	status := "disabled"
	statusOnly, err := service.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, Status: &status})
	if err != nil {
		t.Fatalf("update configured link status: %v", err)
	}
	assertAccessConfig(t, statusOnly.ShortLink, shortlink.RedirectModeIntermediate, 7, &future, false)
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: permission.GroupAdmin}
	active := "active"
	adminStatusOnly, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: created.ShortLink.ID, Status: &active})
	if err != nil {
		t.Fatalf("admin update configured link status: %v", err)
	}
	assertAccessConfig(t, adminStatusOnly.ShortLink, shortlink.RedirectModeIntermediate, 7, &future, false)
	adminList, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("admin list configured short link: %v", err)
	}
	if len(adminList.Items) != 1 || adminList.Items[0].RedirectMode != shortlink.RedirectModeIntermediate || adminList.Items[0].IntermediateDelaySeconds != 7 || adminList.Items[0].ExpiresAt == nil || !adminList.Items[0].ExpiresAt.Equal(future) || adminList.Items[0].Expired {
		t.Fatalf("unexpected admin access config: %#v", adminList.Items)
	}

	cleared, err := service.Update(ctx, user, shortlink.UpdateInput{
		ID:         created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeNever},
	})
	if err != nil {
		t.Fatalf("clear configured link expiration: %v", err)
	}
	assertAccessConfig(t, cleared.ShortLink, shortlink.RedirectModeIntermediate, 7, nil, false)

	ownerFuture := future.Add(time.Hour)
	ownerConfigured, err := service.Update(ctx, user, shortlink.UpdateInput{
		ID: created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{
			Mode:      shortlink.ExpirationModeAt,
			ExpiresAt: &ownerFuture,
		},
	})
	if err != nil {
		t.Fatalf("set owner expiration after clearing it: %v", err)
	}
	assertAccessConfig(t, ownerConfigured.ShortLink, shortlink.RedirectModeIntermediate, 7, &ownerFuture, false)
	ownerCleared, err := service.Update(ctx, user, shortlink.UpdateInput{
		ID:         created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeNever},
	})
	if err != nil {
		t.Fatalf("clear owner expiration: %v", err)
	}
	assertAccessConfig(t, ownerCleared.ShortLink, shortlink.RedirectModeIntermediate, 7, nil, false)

	adminFuture := ownerFuture.Add(time.Hour)
	adminConfigured, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{
		ID: created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{
			Mode:      shortlink.ExpirationModeAt,
			ExpiresAt: &adminFuture,
		},
	})
	if err != nil {
		t.Fatalf("set admin expiration from never: %v", err)
	}
	assertAccessConfig(t, adminConfigured.ShortLink, shortlink.RedirectModeIntermediate, 7, &adminFuture, false)
	adminCleared, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{
		ID:         created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeNever},
	})
	if err != nil {
		t.Fatalf("clear admin expiration: %v", err)
	}
	assertAccessConfig(t, adminCleared.ShortLink, shortlink.RedirectModeIntermediate, 7, nil, false)

	direct := shortlink.RedirectModeDirect
	delay := int16(5)
	adminUpdated, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{
		ID:                       created.ShortLink.ID,
		RedirectMode:             &direct,
		IntermediateDelaySeconds: &delay,
	})
	if err != nil {
		t.Fatalf("admin update configured link: %v", err)
	}
	assertAccessConfig(t, adminUpdated.ShortLink, shortlink.RedirectModeDirect, 5, nil, false)

	if _, err := pool.Exec(ctx, `update short_link set expires_at = now() - interval '1 minute' where id = $1`, created.ShortLink.ID); err != nil {
		t.Fatalf("expire configured short link fixture: %v", err)
	}
	expiredList, err := service.List(ctx, user, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("list expired short link: %v", err)
	}
	if len(expiredList.Items) != 1 || expiredList.Items[0].ExpiresAt == nil || !expiredList.Items[0].Expired {
		t.Fatalf("expected dynamic expired response, got %#v", expiredList.Items)
	}
	expiredAdminList, err := service.AdminList(ctx, admin, shortlink.ListInput{Page: 1, PageSize: 20})
	if err != nil {
		t.Fatalf("admin list expired short link: %v", err)
	}
	if len(expiredAdminList.Items) != 1 || expiredAdminList.Items[0].ExpiresAt == nil || !expiredAdminList.Items[0].Expired {
		t.Fatalf("expected dynamic admin expired response, got %#v", expiredAdminList.Items)
	}
}

// TestServiceAccessConfigValidation verifies stable validation errors for every access setting boundary.
func TestServiceAccessConfigValidation(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	service := shortlink.NewService(pool, permission.NewService())
	created, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com/baseline"})
	if err != nil {
		t.Fatalf("create validation baseline: %v", err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	future := time.Now().UTC().Add(time.Hour)

	tests := []struct {
		name  string
		input shortlink.CreateInput
		err   error
	}{
		{name: "invalid mode", input: shortlink.CreateInput{TargetURL: "https://example.com", RedirectMode: "confirm"}, err: shortlink.ErrInvalidRedirectMode},
		{name: "delay below range", input: shortlink.CreateInput{TargetURL: "https://example.com", IntermediateDelaySeconds: 2}, err: shortlink.ErrInvalidIntermediateDelay},
		{name: "delay above range", input: shortlink.CreateInput{TargetURL: "https://example.com", IntermediateDelaySeconds: 11}, err: shortlink.ErrInvalidIntermediateDelay},
		{name: "missing expiration mode", input: shortlink.CreateInput{TargetURL: "https://example.com", Expiration: &shortlink.ExpirationInput{}}, err: shortlink.ErrInvalidExpiration},
		{name: "never with time", input: shortlink.CreateInput{TargetURL: "https://example.com", Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeNever, ExpiresAt: &future}}, err: shortlink.ErrInvalidExpiration},
		{name: "at without time", input: shortlink.CreateInput{TargetURL: "https://example.com", Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeAt}}, err: shortlink.ErrInvalidExpiration},
		{name: "past expiration", input: shortlink.CreateInput{TargetURL: "https://example.com", Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeAt, ExpiresAt: &past}}, err: shortlink.ErrInvalidExpiration},
		{name: "invalid password", input: shortlink.CreateInput{TargetURL: "https://example.com", Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "short"}}, err: shortlink.ErrInvalidPasswordInput},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Create(ctx, user, test.input)
			if !errors.Is(err, test.err) {
				t.Fatalf("expected %v, got %v", test.err, err)
			}
		})
	}

	invalidMode := "confirm"
	invalidDelay := int16(2)
	updateTests := []struct {
		name  string
		input shortlink.UpdateInput
		err   error
	}{
		{name: "update invalid mode", input: shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &invalidMode}, err: shortlink.ErrInvalidRedirectMode},
		{name: "update invalid delay", input: shortlink.UpdateInput{ID: created.ShortLink.ID, IntermediateDelaySeconds: &invalidDelay}, err: shortlink.ErrInvalidIntermediateDelay},
		{name: "update invalid expiration", input: shortlink.UpdateInput{ID: created.ShortLink.ID, Expiration: &shortlink.ExpirationInput{}}, err: shortlink.ErrInvalidExpiration},
		{name: "update invalid password", input: shortlink.UpdateInput{ID: created.ShortLink.ID, Password: &shortlink.PasswordInput{Mode: shortlink.PasswordModeSet, Value: "short"}}, err: shortlink.ErrInvalidPasswordInput},
	}
	for _, test := range updateTests {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Update(ctx, user, test.input)
			if !errors.Is(err, test.err) {
				t.Fatalf("expected %v, got %v", test.err, err)
			}
		})
	}

	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: permission.GroupAdmin}
	_, err = service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &invalidMode})
	if !errors.Is(err, shortlink.ErrInvalidRedirectMode) {
		t.Fatalf("expected admin invalid redirect mode, got %v", err)
	}

	lowerBoundary, err := service.Create(ctx, user, shortlink.CreateInput{
		TargetURL:                "https://example.com/lower-boundary",
		RedirectMode:             shortlink.RedirectModeIntermediate,
		IntermediateDelaySeconds: 3,
	})
	if err != nil {
		t.Fatalf("create with minimum intermediate delay: %v", err)
	}
	assertAccessConfig(t, lowerBoundary.ShortLink, shortlink.RedirectModeIntermediate, 3, nil, false)

	upperDelay := int16(10)
	upperBoundary, err := service.Update(ctx, user, shortlink.UpdateInput{
		ID:                       created.ShortLink.ID,
		IntermediateDelaySeconds: &upperDelay,
	})
	if err != nil {
		t.Fatalf("update with maximum intermediate delay: %v", err)
	}
	assertAccessConfig(t, upperBoundary.ShortLink, shortlink.RedirectModeDirect, 10, nil, false)
}

// TestServiceAccessConfigValidationDatabaseTimeError keeps the database-time failure isolated from boundary checks.
func TestServiceAccessConfigValidationDatabaseTimeError(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	service := shortlink.NewService(pool, permission.NewService())
	future := time.Now().UTC().Add(time.Hour)
	pool.Close()

	_, err := service.Update(ctx, auth.CurrentUser{GroupKey: permission.GroupUser}, shortlink.UpdateInput{
		ID: "00000000-0000-0000-0000-000000000301",
		Expiration: &shortlink.ExpirationInput{
			Mode:      shortlink.ExpirationModeAt,
			ExpiresAt: &future,
		},
	})
	if err == nil || errors.Is(err, shortlink.ErrInvalidExpiration) {
		t.Fatalf("expected database time query error, got %v", err)
	}
}

// TestServiceAccessConfigRequiresCapabilities verifies status updates remain available when advanced permissions are absent.
func TestServiceAccessConfigRequiresCapabilities(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	fullService := shortlink.NewService(pool, permission.NewService())
	created, err := fullService.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://example.com"})
	if err != nil {
		t.Fatalf("create baseline short link: %v", err)
	}

	limitedPermissions := []string{
		permission.ShortLinkCreate,
		permission.ShortLinkReadOwn,
		permission.ShortLinkUpdateOwn,
		permission.ShortLinkDeleteOwn,
		permission.DomainUseDefault,
	}
	limitedService := shortlink.NewService(pool, permission.NewServiceWithPermissions(limitedPermissions, permission.AdminPermissions))

	_, err = limitedService.Create(ctx, user, shortlink.CreateInput{
		TargetURL:    "https://example.com/intermediate",
		RedirectMode: shortlink.RedirectModeIntermediate,
	})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected intermediate create permission denial, got %v", err)
	}
	future := time.Now().UTC().Add(time.Hour)
	_, err = limitedService.Create(ctx, user, shortlink.CreateInput{
		TargetURL: "https://example.com/expiring",
		Expiration: &shortlink.ExpirationInput{
			Mode:      shortlink.ExpirationModeAt,
			ExpiresAt: &future,
		},
	})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected expiration create permission denial, got %v", err)
	}

	delay := int16(6)
	direct := shortlink.RedirectModeDirect
	directUpdated, err := limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &direct})
	if err != nil {
		t.Fatalf("switch to direct with limited capabilities: %v", err)
	}
	assertAccessConfig(t, directUpdated.ShortLink, shortlink.RedirectModeDirect, 5, nil, false)
	_, err = limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, IntermediateDelaySeconds: &delay})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected intermediate update permission denial, got %v", err)
	}
	_, err = limitedService.Update(ctx, user, shortlink.UpdateInput{
		ID:         created.ShortLink.ID,
		Expiration: &shortlink.ExpirationInput{Mode: shortlink.ExpirationModeNever},
	})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected expiration update permission denial, got %v", err)
	}

	status := "disabled"
	updated, err := limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, Status: &status})
	if err != nil {
		t.Fatalf("status-only update with limited capabilities: %v", err)
	}
	assertAccessConfig(t, updated.ShortLink, shortlink.RedirectModeDirect, 5, nil, false)
}

// TestServiceConfirmationModeRequiresTargetCapability verifies each interactive mode has an independent permission.
func TestServiceConfirmationModeRequiresTargetCapability(t *testing.T) {
	ctx := context.Background()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "alice", "user", permission.UserPermissions)
	fullService := shortlink.NewService(pool, permission.NewService())

	created, err := fullService.Create(ctx, user, shortlink.CreateInput{
		TargetURL:    "https://example.com/confirmation",
		RedirectMode: shortlink.RedirectModeConfirmation,
	})
	if err != nil {
		t.Fatalf("create confirmation short link: %v", err)
	}
	assertAccessConfig(t, created.ShortLink, shortlink.RedirectModeConfirmation, 5, nil, false)

	confirmationPermissions := []string{
		permission.ShortLinkCreate,
		permission.ShortLinkReadOwn,
		permission.ShortLinkUpdateOwn,
		permission.ShortLinkDeleteOwn,
		permission.ShortLinkUseConfirmation,
		permission.DomainUseDefault,
	}
	confirmationService := shortlink.NewService(pool, permission.NewServiceWithPermissions(confirmationPermissions, permission.AdminPermissions))
	confirmationCreated, err := confirmationService.Create(ctx, user, shortlink.CreateInput{
		TargetURL:    "https://example.com/confirmation-only",
		RedirectMode: shortlink.RedirectModeConfirmation,
	})
	if err != nil {
		t.Fatalf("create with confirmation-only capability: %v", err)
	}
	assertAccessConfig(t, confirmationCreated.ShortLink, shortlink.RedirectModeConfirmation, 5, nil, false)
	_, err = confirmationService.Create(ctx, user, shortlink.CreateInput{
		TargetURL:    "https://example.com/intermediate-denied",
		RedirectMode: shortlink.RedirectModeIntermediate,
	})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected intermediate permission denial, got %v", err)
	}

	limitedPermissions := []string{
		permission.ShortLinkCreate,
		permission.ShortLinkReadOwn,
		permission.ShortLinkUpdateOwn,
		permission.ShortLinkDeleteOwn,
		permission.DomainUseDefault,
	}
	limitedService := shortlink.NewService(pool, permission.NewServiceWithPermissions(limitedPermissions, permission.AdminPermissions))
	confirmation := shortlink.RedirectModeConfirmation
	_, err = limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &confirmation})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected confirmation update permission denial, got %v", err)
	}
	direct := shortlink.RedirectModeDirect
	directUpdated, err := limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &direct})
	if err != nil {
		t.Fatalf("switch confirmation link to direct without advanced capabilities: %v", err)
	}
	assertAccessConfig(t, directUpdated.ShortLink, shortlink.RedirectModeDirect, 5, nil, false)
	delay := int16(6)
	_, err = limitedService.Update(ctx, user, shortlink.UpdateInput{ID: created.ShortLink.ID, IntermediateDelaySeconds: &delay})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected explicit delay update permission denial, got %v", err)
	}

	adminWithoutConfirmation := append([]string{}, permission.AdminPermissions...)
	adminWithoutConfirmation = removePermission(adminWithoutConfirmation, permission.ShortLinkUseConfirmation)
	adminService := shortlink.NewService(pool, permission.NewServiceWithPermissions(permission.UserPermissions, adminWithoutConfirmation))
	admin := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000000601", Username: "admin", GroupKey: permission.GroupAdmin}
	_, err = adminService.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: created.ShortLink.ID, RedirectMode: &confirmation})
	if !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("expected current admin group confirmation permission denial, got %v", err)
	}
}

func removePermission(permissions []string, removed string) []string {
	result := make([]string, 0, len(permissions))
	for _, current := range permissions {
		if current != removed {
			result = append(result, current)
		}
	}
	return result
}

func assertAccessConfig(t *testing.T, link shortlink.ShortLink, mode string, delay int16, expiresAt *time.Time, expired bool) {
	t.Helper()
	if link.RedirectMode != mode || link.IntermediateDelaySeconds != delay || link.Expired != expired {
		t.Fatalf("unexpected access config: %#v", link)
	}
	if expiresAt == nil {
		if link.ExpiresAt != nil {
			t.Fatalf("expected no expiration, got %s", link.ExpiresAt)
		}
		return
	}
	if link.ExpiresAt == nil || !link.ExpiresAt.Equal(*expiresAt) {
		t.Fatalf("expected expiration %s, got %v", expiresAt, link.ExpiresAt)
	}
}

// insertShortLinkDefaultDomain creates the default domain used by short-link fixtures.
func insertShortLinkDefaultDomain(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ('00000000-0000-0000-0000-000000000301', 'go.example.com', 'go.example.com', 'short_link', true, true, now(), now())
	`)
	if err != nil {
		t.Fatalf("insert default domain: %v", err)
	}
}

// insertShortLinkUser creates a user and returns its authenticated identity.
func insertShortLinkUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, groupKey string, permissions []string) auth.CurrentUser {
	t.Helper()
	groupID := "00000000-0000-0000-0000-000000000401"
	_, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, description, permissions, builtin, created_at, updated_at)
		values ($1, $2, $2, '', $3::jsonb, false, now(), now())
	`, groupID, groupKey, permissionsJSON(t, permissions))
	if err != nil {
		t.Fatalf("insert user group: %v", err)
	}

	return insertShortLinkUserForGroup(t, ctx, pool, username, groupID, "00000000-0000-0000-0000-000000000501", groupKey, permissions)
}

// insertShortLinkUserForGroup creates a user with explicit group and user identifiers.
func insertShortLinkUserForGroup(t *testing.T, ctx context.Context, pool *pgxpool.Pool, username string, groupID string, userID string, groupKey string, permissions []string) auth.CurrentUser {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into app_user (id, username, password_hash, nickname, group_id, status, builtin, created_at, updated_at)
		values ($1, $2, 'hash', $2, $3, 'active', false, now(), now())
	`, userID, username, groupID)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	return auth.CurrentUser{
		ID:          userID,
		Username:    username,
		Nickname:    username,
		GroupKey:    groupKey,
		Permissions: permissions,
	}
}

// insertStoredShortLink persists a fixture link and returns its identifier.
func insertStoredShortLink(t *testing.T, ctx context.Context, pool *pgxpool.Pool, ownerID string, slug string, targetURL string, status string, deleted bool) string {
	t.Helper()
	deletedAt := "null"
	if deleted {
		deletedAt = "now()"
	}
	var id string
	err := pool.QueryRow(ctx, `
		insert into short_link (id, owner_id, domain_id, slug, target_url, status, created_at, updated_at, deleted_at)
		values (gen_random_uuid(), $1, '00000000-0000-0000-0000-000000000301', $2, $3, $4, now(), now(), `+deletedAt+`)
		returning id::text
	`, ownerID, slug, targetURL, status).Scan(&id)
	if err != nil {
		t.Fatalf("insert stored short link: %v", err)
	}
	return id
}

// insertStoredShortLinkVisitEvent persists a successful redirect event for a fixture link.
func insertStoredShortLinkVisitEvent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, linkID string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into short_link_event (id, short_link_id, event_type, created_at)
		values (gen_random_uuid(), $1, 'redirect_response_sent', now())
	`, linkID)
	if err != nil {
		t.Fatalf("insert short link visit event: %v", err)
	}
}

// insertStoredAnalyticsVisit persists one successful event with normalized analytics dimensions.
func insertStoredAnalyticsVisit(t *testing.T, ctx context.Context, pool *pgxpool.Pool, linkID string, referrerHost string, deviceType string, countryCode string, createdAt string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		insert into short_link_event (id, short_link_id, event_type, referrer_host, device_type, country_code, created_at)
		values (gen_random_uuid(), $1, 'redirect_response_sent', $2, $3, $4, `+createdAt+`)
	`, linkID, referrerHost, deviceType, countryCode)
	if err != nil {
		t.Fatalf("insert analytics visit: %v", err)
	}
}

// ptr returns a pointer to a string literal for optional update fields.
func ptr(value string) *string {
	return &value
}

// assertCreatedAt verifies short-link API models expose a valid creation timestamp.
func assertCreatedAt(t *testing.T, value any) {
	t.Helper()
	payload, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal short link: %v", err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatalf("decode short link: %v", err)
	}
	createdAt, ok := fields["createdAt"].(string)
	if !ok || createdAt == "" {
		t.Fatalf("expected createdAt in %s", payload)
	}
	parsedCreatedAt, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		t.Fatalf("parse createdAt %q: %v", createdAt, err)
	}
	if parsedCreatedAt.IsZero() {
		t.Fatalf("expected non-zero createdAt in %s", payload)
	}
}

// permissionsJSON serializes fixture permissions for direct SQL inserts.
func permissionsJSON(t *testing.T, permissions []string) string {
	t.Helper()
	result := "["
	for index, value := range permissions {
		if index > 0 {
			result += ","
		}
		result += `"` + value + `"`
	}
	result += "]"
	return result
}

// shortLinkTestPool opens a migrated PostgreSQL pool for service integration tests.
func shortLinkTestPool(t *testing.T, ctx context.Context) *pgxpool.Pool {
	return testdb.ProjectMigratedPool(ctx, t)
}
