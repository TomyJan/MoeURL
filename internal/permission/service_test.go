package permission_test

import (
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
)

func TestBuiltInGroupPermissions(t *testing.T) {
	service := permission.NewService()

	if service.Has(permission.GroupGuest, permission.ShortLinkCreate) {
		t.Fatal("expected guest to have no short link create permission")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkCreate) {
		t.Fatal("expected user to create short links")
	}
	if !service.Has(permission.GroupUser, permission.ShortLinkReadOwn) {
		t.Fatal("expected user to read own short links")
	}
	if !service.Has(permission.GroupAdmin, permission.AdminAccess) {
		t.Fatal("expected admin access permission")
	}
	if !service.Has(permission.GroupAdmin, permission.ShortLinkDeleteAll) {
		t.Fatal("expected admin to delete all short links")
	}
}
