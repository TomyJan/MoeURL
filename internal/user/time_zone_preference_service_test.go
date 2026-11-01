package user_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgxpool"
)

// timeZonePreferenceFixture persists independent identities without unrelated domain grants.
func timeZonePreferenceFixture(t *testing.T) (*user.TimeZonePreferenceService, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser) {
	t.Helper()
	pool := userTestPool(t, t.Context())
	for _, group := range []string{"guest", "user", "admin"} {
		insertUserGroup(t, t.Context(), pool, group, nil)
	}
	if _, err := pool.Exec(t.Context(), `update user_group set builtin=true where key in ('guest','user','admin')`); err != nil {
		t.Fatal(err)
	}
	actor := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "zone-owner", "hash", "Owner", "user", "active", false), GroupKey: "user"}
	other := auth.CurrentUser{ID: insertAppUser(t, t.Context(), pool, "zone-other", "hash", "Other", "admin", "active", false), GroupKey: "admin"}
	return user.NewTimeZonePreferenceService(pool), pool, actor, other
}

// TestTimeZonePreferenceConcurrent permits exactly one first save or exact-revision replacement.
func TestTimeZonePreferenceConcurrent(t *testing.T) {
	s, pool, actor, other := timeZonePreferenceFixture(t)
	zone := "Europe/London"
	var expected *string
	for round := 0; round < 2; round++ {
		start := make(chan struct{})
		results := make(chan error, 8)
		var writers sync.WaitGroup
		for i := 0; i < 8; i++ {
			writers.Go(func() {
				<-start
				_, err := s.Update(t.Context(), actor, user.UpdateTimeZonePreferenceInput{TimeZone: &zone, ExpectedUpdatedAt: expected})
				results <- err
			})
		}
		close(start)
		writers.Wait()
		close(results)
		wins, conflicts := 0, 0
		for err := range results {
			if err == nil {
				wins++
			} else if errors.Is(err, user.ErrPreferencesConflict) {
				conflicts++
			} else {
				t.Fatal(err)
			}
		}
		if wins != 1 || conflicts != 7 {
			t.Fatalf("round%d wins=%d conflicts=%d", round, wins, conflicts)
		}
		got, err := s.Get(t.Context(), actor)
		if err != nil || got.Preference.TimeZone == nil || *got.Preference.TimeZone != zone || got.Preference.UpdatedAt == nil {
			t.Fatalf("winner not persisted: %#v %v", got, err)
		}
		if expected != nil {
			before, _ := time.Parse(time.RFC3339Nano, *expected)
			after, _ := time.Parse(time.RFC3339Nano, *got.Preference.UpdatedAt)
			if !after.After(before) {
				t.Fatal("revision failed to advance")
			}
		}
		expected = got.Preference.UpdatedAt
		parsed, parseErr := time.Parse(time.RFC3339Nano, *expected)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		nanoseconds := parsed.Add(time.Nanosecond).Format(time.RFC3339Nano)
		if _, err := s.Update(t.Context(), actor, user.UpdateTimeZonePreferenceInput{ExpectedUpdatedAt: &nanoseconds}); !errors.Is(err, user.ErrPreferencesConflict) {
			t.Fatalf("rounded nanosecond version wrote: %v", err)
		}
	}
	isolated, err := s.Get(t.Context(), other)
	if err != nil || isolated.Preference.TimeZone != nil || isolated.Preference.UpdatedAt != nil {
		t.Fatalf("cross-account preference: %#v %v", isolated, err)
	}
	if _, err := s.Update(t.Context(), other, user.UpdateTimeZonePreferenceInput{TimeZone: &zone, ExpectedUpdatedAt: expected}); !errors.Is(err, user.ErrPreferencesConflict) {
		t.Fatalf("foreign revision accepted: %v", err)
	}
	var rows int
	if err := pool.QueryRow(t.Context(), `select count(*) from user_time_zone_preference`).Scan(&rows); err != nil || rows != 1 {
		t.Fatalf("cross-account write count=%d %v", rows, err)
	}
}

// TestTimeZonePreferenceAuthorization rejects identity changes committed while a request waits for its lock.
func TestTimeZonePreferenceAuthorization(t *testing.T) {
	for _, change := range []string{"disabled", "deleted", "guest_group", "nonbuiltin_group"} {
		t.Run(change, func(t *testing.T) {
			s, pool, actor, _ := timeZonePreferenceFixture(t)
			gate, err := pool.Begin(t.Context())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { testdb.Rollback(t, gate.Rollback) }()
			statement := "LockTimeZonePreferenceUser"
			if change == "nonbuiltin_group" {
				_, err = gate.Exec(t.Context(), `select id from user_group where key='user' for update`)
				statement = "LockTimeZonePreferenceGroup"
			} else {
				_, err = gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID)
			}
			if err != nil {
				t.Fatal(err)
			}
			zone := "UTC"
			done := make(chan error, 1)
			go func() {
				_, err := s.Update(t.Context(), actor, user.UpdateTimeZonePreferenceInput{TimeZone: &zone})
				done <- err
			}()
			waitForDomainPreferenceLock(t, pool, statement)
			switch change {
			case "disabled":
				_, err = gate.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
			case "deleted":
				_, err = gate.Exec(t.Context(), `update app_user set deleted_at=clock_timestamp() where id=$1`, actor.ID)
			case "guest_group":
				_, err = gate.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='guest') where id=$1`, actor.ID)
			case "nonbuiltin_group":
				_, err = gate.Exec(t.Context(), `update user_group set builtin=false where key='user'`)
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := gate.Commit(t.Context()); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if !errors.Is(err, user.ErrPermissionDenied) {
					t.Fatalf("stale identity wrote after %s: %v", change, err)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("write did not leave released lock")
			}
			if _, err := s.Get(t.Context(), actor); !errors.Is(err, user.ErrPermissionDenied) {
				t.Fatalf("ineligible database identity read: %v", err)
			}
			var count int
			if err := pool.QueryRow(t.Context(), `select count(*) from user_time_zone_preference`).Scan(&count); err != nil || count != 0 {
				t.Fatalf("denied write persisted: %d %v", count, err)
			}
		})
	}
}

// TestTimeZonePreferenceCancellation ensures cancellation during account locking cannot create a row.
func TestTimeZonePreferenceCancellation(t *testing.T) {
	s, pool, actor, _ := timeZonePreferenceFixture(t)
	gate, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { testdb.Rollback(t, gate.Rollback) }()
	if _, err := gate.Exec(t.Context(), `select id from app_user where id=$1 for update`, actor.ID); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := s.Update(ctx, actor, user.UpdateTimeZonePreferenceInput{}); done <- err }()
	waitForDomainPreferenceLock(t, pool, "LockTimeZonePreferenceUser")
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("canceled write error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("canceled transaction remained blocked")
	}
	var count int
	if err := pool.QueryRow(t.Context(), `select count(*) from user_time_zone_preference`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("canceled write persisted: %d %v", count, err)
	}
}

// TestTimeZonePreferenceDatabaseRollback verifies a real PostgreSQL write failure leaves no document.
func TestTimeZonePreferenceDatabaseRollback(t *testing.T) {
	s, pool, actor, _ := timeZonePreferenceFixture(t)
	if _, err := pool.Exec(t.Context(), `create function reject_zone_write() returns trigger language plpgsql as $$ begin raise exception 'controlled write failure'; end $$; create trigger reject_zone before insert on user_time_zone_preference for each row execute function reject_zone_write()`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(t.Context(), actor, user.UpdateTimeZonePreferenceInput{}); err == nil {
		t.Fatal("database failure reported success")
	}
	got, err := s.Get(t.Context(), actor)
	if err != nil || got.Preference.TimeZone != nil || got.Preference.UpdatedAt != nil {
		t.Fatalf("failed write left data: %#v %v", got, err)
	}
}
