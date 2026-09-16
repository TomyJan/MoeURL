package shortlink_test

import (
	"errors"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
)

func TestCreateSelectsOnlyAnEnabledGrantedDomain(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "domain-user", "user", permission.UserPermissions)
	assignedID, ungrantedID := uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `update user_group set builtin = true where key = 'user'`); err != nil {
		t.Fatalf("make group built-in: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'https://alt.example.com', 'Alt', 'short_link', true, false, now(), now()),
		       ($2, 'https://private.example.com', 'Private', 'short_link', true, false, now(), now())
	`, assignedID, ungrantedID); err != nil {
		t.Fatalf("prepare assigned domains: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain_user_group (domain_id, user_group_id)
		select domain.id, user_group.id from domain cross join user_group
		where user_group.key = 'user' and domain.host = 'https://alt.example.com'
	`); err != nil {
		t.Fatalf("prepare grants: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())
	defaultLink, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com"})
	if err != nil || !strings.HasPrefix(defaultLink.ShortLink.URL, "https://go.example.com/") {
		t.Fatalf("default link = %#v, %v", defaultLink, err)
	}
	assignedIDText := assignedID.String()
	selected, err := service.Create(ctx, user, shortlink.CreateInput{
		TargetURL: "https://target.example.com", DomainID: &assignedIDText,
	})
	if err != nil || !strings.HasPrefix(selected.ShortLink.URL, "https://alt.example.com/") {
		t.Fatalf("assigned link = %#v, %v", selected, err)
	}
	for _, test := range []struct {
		name, id string
		failure  error
	}{
		{name: "not granted", id: ungrantedID.String(), failure: shortlink.ErrDomainUnavailable},
		{name: "malformed UUID", id: "not-a-uuid", failure: shortlink.ErrInvalidDomainID},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com", DomainID: &test.id})
			if !errors.Is(err, test.failure) {
				t.Fatalf("create error = %v, want %v", err, test.failure)
			}
		})
	}
	if _, err := pool.Exec(ctx, `update domain set enabled = false where id = $1`, assignedID); err != nil {
		t.Fatalf("disable assigned domain: %v", err)
	}
	if _, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com", DomainID: &assignedIDText}); !errors.Is(err, shortlink.ErrDomainUnavailable) {
		t.Fatalf("disabled domain create error = %v", err)
	}
	limited := shortlink.NewService(pool, permission.NewServiceWithPermissions([]string{
		permission.ShortLinkCreate, permission.DomainUseDefault,
	}, permission.AdminPermissions))
	if _, err := limited.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com", DomainID: &assignedIDText}); !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("missing explicit-selection permission error = %v", err)
	}
	if _, err := pool.Exec(ctx, `update domain set enabled = true where id = $1`, assignedID); err != nil {
		t.Fatalf("re-enable assigned domain: %v", err)
	}
	assignedOnly := shortlink.NewService(pool, permission.NewServiceWithPermissions([]string{
		permission.ShortLinkCreate, permission.DomainUseAssigned,
	}, permission.AdminPermissions))
	if _, err := assignedOnly.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com", DomainID: &assignedIDText}); err != nil {
		t.Fatalf("explicit assignment without default permission: %v", err)
	}
	if _, err := assignedOnly.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com"}); !errors.Is(err, shortlink.ErrPermissionDenied) {
		t.Fatalf("default use without permission error = %v", err)
	}
}

func TestCreateRechecksCreatePermissionInsideDomainTransaction(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "revoked-create", "user", permission.UserPermissions)
	// The service's initial snapshot still permits creation, but the stored group
	// loses that permission before the write transaction begins.
	service := shortlink.NewService(pool, permission.NewService())
	if _, err := pool.Exec(ctx, `
		update user_group set permissions = permissions - 'short_link:create' where key = 'user'
	`); err != nil {
		t.Fatalf("revoke stored create permission: %v", err)
	}
	if _, err := service.Create(ctx, user, shortlink.CreateInput{TargetURL: "https://target.example.com"}); !errors.Is(err, shortlink.ErrDomainUnavailable) {
		t.Fatalf("create after stored permission revocation = %v, want ErrDomainUnavailable", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `select count(*) from short_link`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("short links after revoked create = %d, error = %v", count, err)
	}
}

func TestUpdateRetainsStoredDomainAfterDefaultChanges(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertShortLinkDefaultDomain(t, ctx, pool)
	user := insertShortLinkUser(t, ctx, pool, "domain-update", "user", permission.UserPermissions)
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'new.example.com', 'New', 'short_link', true, false, now(), now())
	`, uuid.New()); err != nil {
		t.Fatalf("prepare alternative domain: %v", err)
	}
	service := shortlink.NewService(pool, permission.NewService())
	linkID := insertStoredShortLink(t, ctx, pool, user.ID, "old-domain", "https://target.example.com", "active", false)
	if _, err := pool.Exec(ctx, `update domain set is_default = false where host = 'go.example.com'`); err != nil {
		t.Fatalf("clear former default: %v", err)
	}
	if _, err := pool.Exec(ctx, `update domain set is_default = true where host = 'new.example.com'`); err != nil {
		t.Fatalf("switch default: %v", err)
	}
	newTarget := "https://changed.example.com"
	updated, err := service.Update(ctx, user, shortlink.UpdateInput{ID: linkID, TargetURL: &newTarget})
	if err != nil || updated.ShortLink.URL != "https://go.example.com/old-domain" {
		t.Fatalf("update link URL = %#v, %v", updated, err)
	}
	admin := auth.CurrentUser{ID: user.ID, GroupKey: permission.GroupAdmin}
	adminUpdated, err := service.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: linkID, TargetURL: &newTarget})
	if err != nil || adminUpdated.ShortLink.URL != "https://go.example.com/old-domain" {
		t.Fatalf("admin update link URL = %#v, %v", adminUpdated, err)
	}
}
