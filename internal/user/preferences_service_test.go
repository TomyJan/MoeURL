package user_test

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
)

// TestPreferencesServicePersistenceAndIsolation covers nullable preferences without modifying account metadata.
func TestPreferencesServicePersistenceAndIsolation(t *testing.T) {
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	first := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "first", "hash", "First", "user", "active", false), GroupKey: "user"}
	second := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "second", "hash", "Second", "user", "active", false), GroupKey: "user"}
	service := user.NewPreferencesService(pool)
	var before time.Time
	if err := pool.QueryRow(ctx, `select updated_at from app_user where id=$1`, first.ID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	empty, err := service.Get(ctx, first)
	if err != nil || empty.Preferences.Language != nil || empty.Preferences.Theme != nil || empty.Preferences.UpdatedAt != nil {
		t.Fatalf("unset: %#v, %v", empty, err)
	}
	language, theme := "en", "dark"
	saved, err := service.Update(ctx, first, user.UpdatePreferencesInput{Language: &language, Theme: &theme})
	if err != nil || saved.Preferences.UpdatedAt == nil || *saved.Preferences.Language != language || *saved.Preferences.Theme != theme {
		t.Fatalf("save: %#v, %v", saved, err)
	}
	read, err := service.Get(ctx, first)
	if err != nil || *read.Preferences.UpdatedAt != *saved.Preferences.UpdatedAt || *read.Preferences.Language != language || *read.Preferences.Theme != theme {
		t.Fatalf("read: %#v, %v", read, err)
	}
	preciseVersion, err := time.Parse(time.RFC3339Nano, *saved.Preferences.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	nonMatchingVersion := preciseVersion.Add(time.Nanosecond).Format(time.RFC3339Nano)
	if _, err := service.Update(ctx, first, user.UpdatePreferencesInput{ExpectedUpdatedAt: &nonMatchingVersion}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("nanosecond version was rounded into a matching database version: %v", err)
	}
	other, err := service.Get(ctx, second)
	if err != nil || other.Preferences.UpdatedAt != nil {
		t.Fatalf("other user leaked: %#v, %v", other, err)
	}
	reset, err := service.Update(ctx, first, user.UpdatePreferencesInput{ExpectedUpdatedAt: saved.Preferences.UpdatedAt})
	if err != nil || reset.Preferences.Language != nil || reset.Preferences.Theme != nil || reset.Preferences.UpdatedAt == nil {
		t.Fatalf("reset: %#v, %v", reset, err)
	}
	oldTime, err := time.Parse(time.RFC3339Nano, *saved.Preferences.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	newTime, err := time.Parse(time.RFC3339Nano, *reset.Preferences.UpdatedAt)
	if err != nil {
		t.Fatal(err)
	}
	if !newTime.After(oldTime) {
		t.Fatalf("version did not increase: %v -> %v", oldTime, newTime)
	}
	var after time.Time
	if err := pool.QueryRow(ctx, `select updated_at from app_user where id=$1`, first.ID).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if !after.Equal(before) {
		t.Fatal("preference save modified app_user.updated_at")
	}
	if _, err := service.Update(ctx, first, user.UpdatePreferencesInput{ExpectedUpdatedAt: saved.Preferences.UpdatedAt}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("stale version: %v", err)
	}
	if _, err := service.Update(ctx, first, user.UpdatePreferencesInput{}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("null version replaced existing row: %v", err)
	}
	if _, err := service.Update(ctx, second, user.UpdatePreferencesInput{ExpectedUpdatedAt: saved.Preferences.UpdatedAt}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("non-null version created absent row: %v", err)
	}
}

// TestPreferencesServiceConcurrentWrites admits only one writer for the same optimistic version.
func TestPreferencesServiceConcurrentWrites(t *testing.T) {
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	actor := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "concurrent", "hash", "Concurrent", "user", "active", false), GroupKey: "user"}
	service := user.NewPreferencesService(pool)
	var expected *string
	for round := 0; round < 2; round++ {
		start := make(chan struct{})
		errs := make(chan error, 8)
		var wg sync.WaitGroup
		for i := 0; i < 8; i++ {
			wg.Go(func() {
				<-start
				_, err := service.Update(ctx, actor, user.UpdatePreferencesInput{ExpectedUpdatedAt: expected})
				errs <- err
			})
		}
		close(start)
		wg.Wait()
		close(errs)
		successes, conflicts := 0, 0
		for err := range errs {
			if err == nil {
				successes++
			} else if errors.Is(err, user.ErrPreferencesConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if successes != 1 || conflicts != 7 {
			t.Fatalf("round %d: successes=%d conflicts=%d", round, successes, conflicts)
		}
		current, err := service.Get(ctx, actor)
		if err != nil {
			t.Fatal(err)
		}
		expected = current.Preferences.UpdatedAt
	}
}

// TestPreferencesServiceRejectsOverPreciseVersion prevents sub-nanosecond input from being truncated into a valid stored version.
func TestPreferencesServiceRejectsOverPreciseVersion(t *testing.T) {
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	actor := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "precision", "hash", "Precision", "user", "active", false), GroupKey: "user"}
	if _, err := pool.Exec(ctx, `insert into user_preference(user_id,language,theme,updated_at) values($1,'en','dark','2026-10-16T12:00:00.123456Z')`, actor.ID); err != nil {
		t.Fatal(err)
	}
	service := user.NewPreferencesService(pool)
	version := "2026-10-16T12:00:00.1234560001Z"
	if _, err := service.Update(ctx, actor, user.UpdatePreferencesInput{ExpectedUpdatedAt: &version}); !errors.Is(err, user.ErrInvalidInput) {
		t.Fatalf("sub-nanosecond version error = %v, want ErrInvalidInput", err)
	}
	current, err := service.Get(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	if current.Preferences.Language == nil || *current.Preferences.Language != "en" || current.Preferences.Theme == nil || *current.Preferences.Theme != "dark" || current.Preferences.UpdatedAt == nil || *current.Preferences.UpdatedAt != "2026-10-16T12:00:00.123456Z" {
		t.Fatalf("invalid version changed stored preferences: %#v", current)
	}
	// Equivalent RFC3339 offsets retain their instant semantics without requiring canonical UTC text.
	version = "2026-10-16T20:00:00.123456000+08:00"
	if _, err := service.Update(ctx, actor, user.UpdatePreferencesInput{ExpectedUpdatedAt: &version}); err != nil {
		t.Fatalf("equivalent offset version: %v", err)
	}
}

// TestPreferencesServiceRejectsInactiveAndGuestUsers rechecks eligibility in the database for both operations.
func TestPreferencesServiceRejectsInactiveAndGuestUsers(t *testing.T) {
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	insertUserGroup(t, ctx, pool, "guest", nil)
	service := user.NewPreferencesService(pool)
	disabled := insertAppUser(t, ctx, pool, "disabled", "hash", "Disabled", "user", "disabled", false)
	deleted := insertAppUser(t, ctx, pool, "deleted", "hash", "Deleted", "user", "active", false)
	guest := insertAppUser(t, ctx, pool, "dbguest", "hash", "Guest", "guest", "active", false)
	if _, err := pool.Exec(ctx, `update app_user set deleted_at=now() where id=$1`, deleted); err != nil {
		t.Fatal(err)
	}
	for _, actor := range []auth.CurrentUser{auth.GuestUser(), {ID: "invalid", GroupKey: "user"}, {ID: "00000000-0000-0000-0000-000000000099", GroupKey: "user"}, {ID: disabled, GroupKey: "user"}, {ID: deleted, GroupKey: "user"}, {ID: guest, GroupKey: "user"}, {ID: disabled, GroupKey: "guest"}} {
		if _, err := service.Get(ctx, actor); !errors.Is(err, user.ErrPermissionDenied) {
			t.Fatalf("Get(%#v): %v", actor, err)
		}
		if _, err := service.Update(ctx, actor, user.UpdatePreferencesInput{}); !errors.Is(err, user.ErrPermissionDenied) {
			t.Fatalf("Update(%#v): %v", actor, err)
		}
	}
}
