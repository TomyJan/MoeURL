package user_test

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// domainPreferenceFixture uses real persisted users, groups, domains and grants.
func domainPreferenceFixture(t *testing.T) (*user.DomainPreferenceService, *domain.Service, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser, string, domain.ChangeInput) {
	t.Helper()
	ctx := t.Context()
	pool := userTestPool(t, ctx)
	insertUserGroup(t, ctx, pool, "user", permission.UserPermissions)
	insertUserGroup(t, ctx, pool, "admin", permission.AdminPermissions)
	insertUserGroup(t, ctx, pool, "guest", nil)
	if _, err := pool.Exec(ctx, `update user_group set builtin=true where key in ('guest','user','admin')`); err != nil {
		t.Fatal(err)
	}
	actor := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "domain-owner", "hash", "Owner", "user", "active", false), GroupKey: "user"}
	admin := auth.CurrentUser{ID: insertAppUser(t, ctx, pool, "domain-admin", "hash", "Admin", "admin", "active", false), GroupKey: "admin"}
	defaultID, assignedID := uuid.NewString(), uuid.NewString()
	if _, err := pool.Exec(ctx, `
		insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values($1,'https://default.example.com','Default','short_link',true,true,now(),now()),
		($2,'https://assigned.example.com','Assigned','short_link',true,false,now(),now());
	`, defaultID, assignedID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) select d.id,g.id from domain d cross join user_group g where g.key in ('user','admin')`); err != nil {
		t.Fatal(err)
	}
	var revision time.Time
	if err := pool.QueryRow(ctx, `select updated_at from domain where id=$1`, assignedID).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	return user.NewDomainPreferenceService(pool), domain.NewService(pool, permission.NewDatabaseService(pool)), pool, actor, admin, defaultID,
		domain.ChangeInput{ID: assignedID, ExpectedUpdatedAt: revision.UTC().Format(time.RFC3339Nano)}
}

// TestDomainPreferencePersistence protects independent versions and account ownership.
func TestDomainPreferencePersistence(t *testing.T) {
	s, _, pool, actor, other, defaultID, assigned := domainPreferenceFixture(t)
	ctx := t.Context()
	initial, err := s.Get(ctx, actor)
	if err != nil || initial.Preference.DomainID != nil || initial.Preference.UpdatedAt != nil {
		t.Fatalf("unset: %#v %v", initial, err)
	}
	saved, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
	if err != nil || saved.Preference.DomainID == nil || *saved.Preference.DomainID != assigned.ID || saved.Preference.UpdatedAt == nil {
		t.Fatalf("save: %#v %v", saved, err)
	}
	isolated, err := s.Get(ctx, other)
	if err != nil || isolated.Preference.DomainID != nil || isolated.Preference.UpdatedAt != nil {
		t.Fatalf("another account inherited a preference: %#v %v", isolated, err)
	}
	if _, err := s.Update(ctx, other, user.UpdateDomainPreferenceInput{DomainID: &defaultID, ExpectedUpdatedAt: saved.Preference.UpdatedAt}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("another account's version created a new record: %v", err)
	}
	language, theme := "en", "dark"
	interfaceService := user.NewPreferencesService(pool)
	interfaceSaved, err := interfaceService.Update(ctx, actor, user.UpdatePreferencesInput{Language: &language, Theme: &theme})
	if err != nil {
		t.Fatalf("domain save interfered with first language/theme save: %v", err)
	}
	cleared, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{ExpectedUpdatedAt: saved.Preference.UpdatedAt})
	if err != nil || cleared.Preference.DomainID != nil || cleared.Preference.UpdatedAt == nil {
		t.Fatalf("clear: %#v %v", cleared, err)
	}
	before, _ := time.Parse(time.RFC3339Nano, *saved.Preference.UpdatedAt)
	after, parseErr := time.Parse(time.RFC3339Nano, *cleared.Preference.UpdatedAt)
	if parseErr != nil || !after.After(before) {
		t.Fatalf("version not strictly increasing: %v -> %v (%v)", before, after, parseErr)
	}
	nanosecondVersion := after.Add(time.Nanosecond).Format(time.RFC3339Nano)
	if _, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{ExpectedUpdatedAt: &nanosecondVersion}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("nanosecond tail rounded into the stored version: %v", err)
	}
	interfaceRead, err := interfaceService.Get(ctx, actor)
	if err != nil || *interfaceRead.Preferences.UpdatedAt != *interfaceSaved.Preferences.UpdatedAt || *interfaceRead.Preferences.Language != "en" || *interfaceRead.Preferences.Theme != "dark" {
		t.Fatalf("domain clear modified language/theme: %#v %v", interfaceRead, err)
	}
}

// TestDomainPreferenceAuthorizationAfterLockWait rechecks changes committed while the request was blocked.
func TestDomainPreferenceAuthorizationAfterLockWait(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "group_changed", "group_revoked", "grant_removed"} {
		t.Run(change, func(t *testing.T) {
			s, _, pool, actor, _, _, assigned := domainPreferenceFixture(t)
			gate, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { testdb.Rollback(t, gate.Rollback) }()
			statement := "LockDomainPreferenceUser"
			switch change {
			case "group_revoked":
				_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
				statement = "LockDomainPreferenceGroup"
			case "grant_removed":
				_, err = gate.Exec(t.Context(), `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
				statement = "pg_advisory_xact_lock_shared"
			default:
				_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() {
				_, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
				result <- err
			}()
			waitForDomainPreferenceLock(t, pool, statement)
			switch change {
			case "disabled":
				_, err = gate.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
			case "deleted":
				_, err = gate.Exec(t.Context(), `update app_user set deleted_at=clock_timestamp() where id=$1`, actor.ID)
			case "group_changed":
				_, err = gate.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='guest') where id=$1`, actor.ID)
			case "group_revoked":
				_, err = gate.Exec(t.Context(), `update user_group set permissions='[]'::jsonb where key='user'`)
			case "grant_removed":
				_, err = gate.Exec(t.Context(), `delete from domain_user_group where domain_id=$1 and user_group_id=(select id from user_group where key='user')`, assigned.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := gate.Commit(t.Context()); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-result:
				if !errors.Is(err, user.ErrPermissionDenied) {
					t.Fatalf("request used stale authorization after %s: %v", change, err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("save did not complete after the lock was released")
			}
			var count int
			if err := pool.QueryRow(t.Context(), `select count(*) from user_domain_preference`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("denied request persisted a selection: count=%d err=%v", count, err)
			}
		})
	}
}

// TestDomainPreferenceConcurrentWrites permits exactly one first-save or versioned winner.
func TestDomainPreferenceConcurrentWrites(t *testing.T) {
	s, _, _, actor, _, _, assigned := domainPreferenceFixture(t)
	var expected *string
	for round := 0; round < 2; round++ {
		start := make(chan struct{})
		results := make(chan error, 8)
		var writers sync.WaitGroup
		for i := 0; i < 8; i++ {
			writers.Go(func() {
				<-start
				_, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID, ExpectedUpdatedAt: expected})
				results <- err
			})
		}
		close(start)
		writers.Wait()
		close(results)
		won, conflicts := 0, 0
		for err := range results {
			if err == nil {
				won++
			} else if errors.Is(err, user.ErrPreferencesConflict) {
				conflicts++
			} else {
				t.Fatalf("unexpected concurrent result: %v", err)
			}
		}
		if won != 1 || conflicts != 7 {
			t.Fatalf("round %d: won=%d conflicts=%d", round, won, conflicts)
		}
		read, err := s.Get(t.Context(), actor)
		if err != nil {
			t.Fatal(err)
		}
		expected = read.Preference.UpdatedAt
	}
}

// TestDomainPreferenceDefaultRoleChange reevaluates the required permission when administrators change the default.
func TestDomainPreferenceDefaultRoleChange(t *testing.T) {
	s, _, pool, actor, _, defaultID, assigned := domainPreferenceFixture(t)
	ctx := t.Context()
	if _, err := pool.Exec(ctx, `update user_group set permissions='["short_link:create","domain:use_assigned"]'::jsonb where key='user'`); err != nil {
		t.Fatal(err)
	}
	saved, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { testdb.Rollback(t, tx.Rollback) }()
	if _, err := tx.Exec(ctx, `update domain set is_default=false where is_default`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `update domain set is_default=true where id=$1`, assigned.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID, ExpectedUpdatedAt: saved.Preference.UpdatedAt}); !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("assigned-only permission selected the new global default: %v", err)
	}
	if _, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &defaultID, ExpectedUpdatedAt: saved.Preference.UpdatedAt}); err != nil {
		t.Fatalf("old default did not become an eligible assigned choice: %v", err)
	}
}

// TestDomainPreferenceCurrentAuthorization checks the live permission/grant/domain intersection.
func TestDomainPreferenceCurrentAuthorization(t *testing.T) {
	s, _, pool, actor, _, defaultID, assigned := domainPreferenceFixture(t)
	ctx := t.Context()
	for _, tc := range []struct {
		name        string
		permissions []string
		target      string
		enabled     bool
		granted     bool
		want        error
	}{
		{"default only accepts default", []string{"short_link:create", "domain:use_default"}, defaultID, true, true, nil},
		{"default only rejects assigned", []string{"short_link:create", "domain:use_default"}, assigned.ID, true, true, user.ErrPermissionDenied},
		{"assigned only accepts assigned", []string{"short_link:create", "domain:use_assigned"}, assigned.ID, true, true, nil},
		{"assigned only rejects default", []string{"short_link:create", "domain:use_assigned"}, defaultID, true, true, user.ErrPermissionDenied},
		{"creation denied", []string{"domain:use_assigned"}, assigned.ID, true, true, user.ErrPermissionDenied},
		{"grant removed", permission.UserPermissions, assigned.ID, true, false, user.ErrPermissionDenied},
		{"domain disabled", permission.UserPermissions, assigned.ID, false, true, user.ErrPermissionDenied},
		{"unknown domain", permission.UserPermissions, uuid.NewString(), true, true, user.ErrPermissionDenied},
	} {
		t.Run(tc.name, func(t *testing.T) {
			permissions, err := json.Marshal(tc.permissions)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `update user_group set permissions=$1::jsonb where key='user';`, permissions); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `update domain set enabled=$1 where id=$2`, tc.enabled, assigned.ID); err != nil {
				t.Fatal(err)
			}
			if _, err := pool.Exec(ctx, `delete from domain_user_group where domain_id=$1 and user_group_id=(select id from user_group where key='user')`, assigned.ID); err != nil {
				t.Fatal(err)
			}
			if tc.granted {
				if _, err := pool.Exec(ctx, `insert into domain_user_group select $1,id from user_group where key='user'`, assigned.ID); err != nil {
					t.Fatal(err)
				}
			}
			read, err := s.Get(ctx, actor)
			if err != nil {
				t.Fatal(err)
			}
			_, err = s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &tc.target, ExpectedUpdatedAt: read.Preference.UpdatedAt})
			if !errors.Is(err, tc.want) {
				t.Fatalf("authorization=%v want=%v", err, tc.want)
			}
		})
	}
	// The caller's group snapshot cannot override a database group change.
	if _, err := pool.Exec(ctx, `update app_user set group_id=(select id from user_group where key='admin') where id=$1;`, actor.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update user_group set permissions='[]'::jsonb where key='admin'`); err != nil {
		t.Fatal(err)
	}
	current, err := s.Get(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{DomainID: &defaultID, ExpectedUpdatedAt: current.Preference.UpdatedAt}); !errors.Is(err, user.ErrPermissionDenied) {
		t.Fatalf("stale actor group authorized a save: %v", err)
	}
	if _, err := s.Update(ctx, actor, user.UpdateDomainPreferenceInput{ExpectedUpdatedAt: current.Preference.UpdatedAt}); err != nil {
		t.Fatalf("revocation prevented personal cleanup: %v", err)
	}
}

// TestDomainPreferenceDeleteClearsVersion catches a domain deletion that forgets preference cleanup.
func TestDomainPreferenceDeleteClearsVersion(t *testing.T) {
	s, domains, _, actor, admin, defaultID, assigned := domainPreferenceFixture(t)
	saved, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
	if err != nil {
		t.Fatal(err)
	}
	if err := domains.Delete(t.Context(), admin, assigned); err != nil {
		t.Fatalf("delete must clear personal references atomically: %v", err)
	}
	cleared, err := s.Get(t.Context(), actor)
	if err != nil || cleared.Preference.DomainID != nil || cleared.Preference.UpdatedAt == nil || *cleared.Preference.UpdatedAt == *saved.Preference.UpdatedAt {
		t.Fatalf("deleted domain left a selection or reusable revision: %#v %v", cleared, err)
	}
	if _, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &defaultID, ExpectedUpdatedAt: saved.Preference.UpdatedAt}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("stale editor overwrote deletion cleanup: %v", err)
	}
}

// waitForDomainPreferenceLock observes the actual blocked statement instead of relying on elapsed time.
func waitForDomainPreferenceLock(t *testing.T, pool *pgxpool.Pool, statement string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 4*time.Second)
	defer cancel()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and position($1 in query)>0)`, statement).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ticker.C:
		case <-ctx.Done():
			t.Fatalf("statement did not reach the controlled lock: %s", statement)
		}
	}
}

// TestDomainPreferenceDeleteConcurrency serializes both orderings of saving against deletion.
func TestDomainPreferenceDeleteConcurrency(t *testing.T) {
	for _, deleteFirst := range []bool{false, true} {
		name := "save_first"
		if deleteFirst {
			name = "delete_first"
		}
		t.Run(name, func(t *testing.T) {
			s, domains, pool, actor, admin, _, assigned := domainPreferenceFixture(t)
			saved, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
			if err != nil {
				t.Fatal(err)
			}
			gate, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { testdb.Rollback(t, gate.Rollback) }()
			if _, err := gate.Exec(t.Context(), `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d)); err != nil {
				t.Fatal(err)
			}
			saveResult, deleteResult := make(chan error, 1), make(chan error, 1)
			save := func() {
				_, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID, ExpectedUpdatedAt: saved.Preference.UpdatedAt})
				saveResult <- err
			}
			remove := func() { deleteResult <- domains.Delete(t.Context(), admin, assigned) }
			if deleteFirst {
				go remove()
				waitForDomainPreferenceLock(t, pool, "pg_advisory_xact_lock($1)")
				go save()
				waitForDomainPreferenceLock(t, pool, "pg_advisory_xact_lock_shared")
			} else {
				go save()
				waitForDomainPreferenceLock(t, pool, "pg_advisory_xact_lock_shared")
				go remove()
				waitForDomainPreferenceLock(t, pool, "pg_advisory_xact_lock($1)")
			}
			if err := gate.Commit(t.Context()); err != nil {
				t.Fatal(err)
			}
			if err := <-deleteResult; err != nil {
				t.Fatalf("concurrent delete: %v", err)
			}
			want := error(nil)
			if deleteFirst {
				want = user.ErrPermissionDenied
			}
			if err := <-saveResult; !errors.Is(err, want) {
				t.Fatalf("concurrent save=%v want=%v", err, want)
			}
			read, err := s.Get(t.Context(), actor)
			if err != nil || read.Preference.DomainID != nil || *read.Preference.UpdatedAt == *saved.Preference.UpdatedAt {
				t.Fatalf("delete/save left stale state: %#v %v", read, err)
			}
		})
	}
}

// TestDomainPreferenceDeleteRollback ensures cleanup and the domain delete share one commit boundary.
func TestDomainPreferenceDeleteRollback(t *testing.T) {
	for _, target := range []string{"domain", "user_domain_preference"} {
		t.Run(target, func(t *testing.T) {
			s, domains, pool, actor, admin, _, assigned := domainPreferenceFixture(t)
			saved, err := s.Update(t.Context(), actor, user.UpdateDomainPreferenceInput{DomainID: &assigned.ID})
			if err != nil {
				t.Fatal(err)
			}
			event := "delete"
			if target == "user_domain_preference" {
				event = "update"
			}
			if _, err := pool.Exec(t.Context(), `create function fail_domain_preference_cleanup() returns trigger language plpgsql as $$ begin raise exception 'controlled domain preference fault'; end $$; create trigger fail_domain_preference_cleanup before `+event+` on `+target+` for each row execute function fail_domain_preference_cleanup()`); err != nil {
				t.Fatal(err)
			}
			if err := domains.Delete(t.Context(), admin, assigned); err == nil {
				t.Fatal("controlled delete failure was ignored")
			}
			read, err := s.Get(t.Context(), actor)
			if err != nil || read.Preference.DomainID == nil || *read.Preference.DomainID != assigned.ID || *read.Preference.UpdatedAt != *saved.Preference.UpdatedAt {
				t.Fatalf("failed deletion partially committed cleanup: %#v %v", read, err)
			}
		})
	}
}
