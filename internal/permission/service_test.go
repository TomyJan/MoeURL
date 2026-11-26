package permission_test

import (
	"context"
	"testing"

	"github.com/TomyJan/MoeURL/internal/permission"
)

// TestBuiltInGroupPermissions verifies built in group permissions.
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

// TestStaticPermissionSnapshots verifies static permission snapshots.
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

func TestResolveForGuestBypassesDatabaseAccountLookup(t *testing.T) {
	resolver := permission.NewDatabaseService(nil)
	for name, resolve := range map[string]func() (permission.Snapshot, error){
		"account": func() (permission.Snapshot, error) {
			return permission.ResolveForAccount(context.Background(), resolver, "", permission.GroupGuest)
		},
		"transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountIn(context.Background(), nil, resolver, "", permission.GroupGuest)
		},
		"locked transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountLockedIn(context.Background(), nil, resolver, "", permission.GroupGuest)
		},
	} {
		t.Run(name, func(t *testing.T) {
			snapshot, err := resolve()
			if err != nil || snapshot.Has(permission.ShortLinkCreate) {
				t.Fatalf("guest permissions = %v, error = %v; want empty permissions without database I/O", snapshot.Has(permission.ShortLinkCreate), err)
			}
		})
	}
}

func TestResolveForAccountUsesStaticResolverOnlyAsTestFallback(t *testing.T) {
	static := permission.NewService()
	for name, resolve := range map[string]func() (permission.Snapshot, error){
		"account": func() (permission.Snapshot, error) {
			return permission.ResolveForAccount(context.Background(), static, "", permission.GroupUser)
		},
		"transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountIn(context.Background(), nil, static, "", permission.GroupUser)
		},
		"locked transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountLockedIn(context.Background(), nil, static, "", permission.GroupUser)
		},
	} {
		t.Run(name, func(t *testing.T) {
			snapshot, err := resolve()
			if err != nil || !snapshot.Has(permission.ShortLinkCreate) {
				t.Fatalf("static user permissions = %v, error = %v; want create permission", snapshot.Has(permission.ShortLinkCreate), err)
			}
		})
	}

	for name, resolve := range map[string]func() (permission.Snapshot, error){
		"account": func() (permission.Snapshot, error) {
			return permission.ResolveForAccount(context.Background(), permission.NewDatabaseService(nil), "", permission.GroupUser)
		},
		"transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountIn(context.Background(), nil, permission.NewDatabaseService(nil), "", permission.GroupUser)
		},
		"locked transaction": func() (permission.Snapshot, error) {
			return permission.ResolveForAccountLockedIn(context.Background(), nil, permission.NewDatabaseService(nil), "", permission.GroupUser)
		},
	} {
		t.Run("database resolver rejects missing ID/"+name, func(t *testing.T) {
			if snapshot, err := resolve(); err == nil || snapshot.Has(permission.ShortLinkCreate) {
				t.Fatalf("database user permissions = %v, error = %v; want a closed error", snapshot.Has(permission.ShortLinkCreate), err)
			}
		})
	}
}

func TestDecodeSnapshotsRejectMalformedAndUnassignableStoredGroups(t *testing.T) {
	if _, err := permission.DecodeGroupSnapshot(permission.GroupUser, true, []byte(`[`)); err == nil {
		t.Fatal("malformed builtin permissions were accepted")
	}
	if _, err := permission.DecodeGroupSnapshot(permission.GroupUser, false, []byte(`[]`)); err != permission.ErrUnknownGroup {
		t.Fatalf("reserved non-builtin group error = %v, want ErrUnknownGroup", err)
	}
	if _, err := permission.DecodeSnapshot([]byte(`{`)); err == nil {
		t.Fatal("malformed permission snapshot was accepted")
	}
	snapshot, err := permission.DecodeSnapshot([]byte(`[` + `"admin:access"` + `]`))
	if err != nil || !snapshot.Has(permission.AdminAccess) {
		t.Fatalf("valid permission snapshot = %v, %v", snapshot.Has(permission.AdminAccess), err)
	}
}
