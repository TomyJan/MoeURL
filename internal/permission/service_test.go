package permission_test

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
)

func TestBuiltInGroupPermissions(t *testing.T) {
	service := permission.NewService()

	if service.Has("unknown", permission.ShortLinkCreate) {
		t.Fatal("expected unknown group to have no permissions")
	}
	if service.Has(permission.GroupGuest, permission.ShortLinkCreate) {
		t.Fatal("expected guest to have no short link create permission")
	}
	if service.Has(permission.GroupUser, "unknown:permission") {
		t.Fatal("expected user group to reject unknown permission")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkCreate) {
		t.Fatal("expected user to create short links")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkReadOwn) {
		t.Fatal("expected user to read own short links")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkUseIntermediate) {
		t.Fatal("expected user to use intermediate redirects")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkSetExpiration) {
		t.Fatal("expected user to set short link expiration")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkSetPassword) {
		t.Fatal("expected user to set short link password")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkUseConfirmation) {
		t.Fatal("expected user to use confirmation redirects")
	}
	if service.Has(permission.GroupGuest, permission.ShortLinkUseIntermediate) {
		t.Fatal("expected guest to have no intermediate redirect permission")
	}
	if service.Has(permission.GroupGuest, permission.ShortLinkSetExpiration) {
		t.Fatal("expected guest to have no short link expiration permission")
	}
	if service.Has(permission.GroupGuest, permission.ShortLinkSetPassword) {
		t.Fatal("expected guest to have no short link password permission")
	}
	if service.Has(permission.GroupGuest, permission.ShortLinkUseConfirmation) {
		t.Fatal("expected guest to have no confirmation redirect permission")
	}
	if !service.Has(permission.GroupAdmin, permission.AdminAccess) {
		t.Fatal("expected admin access permission")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkDeleteAll) {
		t.Fatal("expected admin to delete all short links")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkUseIntermediate) {
		t.Fatal("expected admin to use intermediate redirects")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkSetExpiration) {
		t.Fatal("expected admin to set short link expiration")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkSetPassword) {
		t.Fatal("expected admin to set short link password")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkUseConfirmation) {
		t.Fatal("expected admin to use confirmation redirects")
	}
}

func TestStaticPermissionSnapshots(t *testing.T) {
	service := permission.NewService()
	userPermissions, err := service.Resolve(context.Background(), permission.GroupUser)
	if err != nil {
		t.Fatalf("resolve user permissions: %v", err)
	}
	if !userPermissions.Has(permission.ShortLinkUseConfirmation) {
		t.Fatal("expected user snapshot to include confirmation permission")
	}
	unknownPermissions, err := service.Resolve(context.Background(), "unknown")
	if err != nil {
		t.Fatalf("resolve unknown permissions: %v", err)
	}
	if unknownPermissions.Has(permission.ShortLinkUseConfirmation) {
		t.Fatal("expected unknown snapshot to deny confirmation permission")
	}
}
