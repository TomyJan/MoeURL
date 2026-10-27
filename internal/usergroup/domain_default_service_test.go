package usergroup

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

type defaultFixture struct {
	s        *DomainDefaultService
	legacy   *Service
	pool     *pgxpool.Pool
	actor    auth.CurrentUser
	global   string
	assigned string
	hidden   string
	disabled string
}

// groupDefaultFixture provides independently persisted groups, grants and domain roles.
func groupDefaultFixture(t *testing.T) defaultFixture {
	t.Helper()
	legacy, pool, actor, _ := permissionWriterFixture(t)
	f := defaultFixture{s: NewDomainDefaultService(pool), legacy: legacy, pool: pool, actor: actor,
		global: uuid.NewString(), assigned: uuid.NewString(), hidden: uuid.NewString(), disabled: uuid.NewString()}
	for _, item := range []struct {
		id, host           string
		enabled, isDefault bool
		order              int
	}{
		{f.global, "https://global.example.com", true, true, 100},
		{f.assigned, "https://assigned.example.com", true, false, 0},
		{f.hidden, "https://admin-only.example.com", true, false, -100},
		{f.disabled, "https://disabled.example.com", false, false, -200},
	} {
		_, err := pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,sort_order,created_at,updated_at)
			values($1,$2,'Choice','short_link',$3,$4,$5,now(),now())`, item.id, item.host, item.enabled, item.isDefault, item.order)
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id)
			select $1,id from user_group where key='admin' or (key='user' and $1::uuid<>$2::uuid)`, item.id, f.hidden)
		require.NoError(t, err)
	}
	return f
}

// input preserves the raw group revision rather than deriving expectations from the write implementation.
func (f defaultFixture) input(t *testing.T, group string, selected *string) SetDomainDefaultInput {
	t.Helper()
	var at time.Time
	require.NoError(t, f.pool.QueryRow(t.Context(), `select updated_at from user_group where key=$1`, group).Scan(&at))
	return SetDomainDefaultInput{GroupKey: group, DomainID: selected, ExpectedUpdatedAt: at.UTC().Format(time.RFC3339Nano)}
}

// Catches actor-based candidates, lost global precedence, stale same-value writes and noisy no-ops.
func TestGroupDefaultCandidatesAndRevisions(t *testing.T) {
	f := groupDefaultFixture(t)
	read, err := f.s.Get(t.Context(), f.actor, "user")
	require.NoError(t, err)
	ids := make([]string, 0, len(read.Candidates))
	for _, candidate := range read.Candidates {
		ids = append(ids, candidate.ID)
	}
	require.Equal(t, []string{f.global, f.assigned}, ids)
	input := f.input(t, "user", &f.assigned)
	saved, err := f.s.Set(t.Context(), f.actor, input)
	require.NoError(t, err)
	require.Equal(t, &f.assigned, saved.Setting.DomainID)
	var before int
	require.NoError(t, f.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&before))
	current := f.input(t, "user", &f.assigned)
	unchanged, err := f.s.Set(t.Context(), f.actor, current)
	require.NoError(t, err)
	require.Equal(t, saved, unchanged)
	var after int
	require.NoError(t, f.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&after))
	require.Equal(t, before, after)
	_, err = f.s.Set(t.Context(), f.actor, input)
	require.ErrorIs(t, err, ErrPermissionConflict)
	at, err := time.Parse(time.RFC3339Nano, current.ExpectedUpdatedAt)
	require.NoError(t, err)
	current.ExpectedUpdatedAt = at.Add(time.Nanosecond).Format(time.RFC3339Nano)
	_, err = f.s.Set(t.Context(), f.actor, current)
	require.ErrorIs(t, err, ErrPermissionConflict)
}

// Catches grants/creation/domain-role checks being replaced by the manager's own permissions.
func TestGroupDefaultTargetPermissionIntersection(t *testing.T) {
	for _, scenario := range []struct {
		name, permissions string
		global, assigned  bool
	}{
		{"default only", `["short_link:create","domain:use_default"]`, true, false},
		{"assigned only", `["short_link:create","domain:use_assigned"]`, false, true},
		{"no creation", `["domain:use_default","domain:use_assigned"]`, false, false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := groupDefaultFixture(t)
			_, err := f.pool.Exec(t.Context(), `update user_group set permissions=$1 where key='user'`, []byte(scenario.permissions))
			require.NoError(t, err)
			for _, choice := range []struct {
				id      string
				allowed bool
			}{{f.global, scenario.global}, {f.assigned, scenario.assigned}, {f.hidden, false}, {f.disabled, false}, {uuid.NewString(), false}} {
				_, err := f.s.Set(t.Context(), f.actor, f.input(t, "user", &choice.id))
				if choice.allowed {
					require.NoError(t, err)
				} else {
					require.ErrorIs(t, err, ErrPermissionDenied)
				}
			}
			_, err = f.s.Set(t.Context(), f.actor, f.input(t, "user", nil))
			require.NoError(t, err, "clearing does not require target creation permissions")
		})
	}
}

// Catches shared group CAS letting two writers win or erasing the field owned by the other action.
func TestGroupDefaultPermissionAndDefaultCAS(t *testing.T) {
	f := groupDefaultFixture(t)
	input := f.input(t, "user", &f.assigned)
	start, results := make(chan struct{}), make(chan error, 2)
	go func() { <-start; _, err := f.s.Set(t.Context(), f.actor, input); results <- err }()
	go func() {
		<-start
		_, err := f.legacy.UpdatePermissions(t.Context(), f.actor, UpdatePermissionsInput{GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: input.ExpectedUpdatedAt})
		results <- err
	}()
	close(start)
	wins, conflicts := 0, 0
	for range 2 {
		err := <-results
		if err == nil {
			wins++
		} else if errors.Is(err, ErrPermissionConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	require.Equal(t, 1, wins)
	require.Equal(t, 1, conflicts)
	// Restore target permission eligibility without changing the saved default.
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","domain:use_assigned"]' where key='user'`)
	require.NoError(t, err)
	saved, err := f.s.Set(t.Context(), f.actor, f.input(t, "user", &f.assigned))
	require.NoError(t, err)
	permissionWrite, err := f.legacy.UpdatePermissions(t.Context(), f.actor, UpdatePermissionsInput{GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: saved.Setting.UpdatedAt})
	require.NoError(t, err)
	var selected string
	require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text from user_group where key='user'`).Scan(&selected))
	require.Equal(t, f.assigned, selected)
	_, err = f.s.Set(t.Context(), f.actor, SetDomainDefaultInput{GroupKey: "user", ExpectedUpdatedAt: permissionWrite.Group.UpdatedAt})
	require.NoError(t, err)
	var stored []byte
	require.NoError(t, f.pool.QueryRow(t.Context(), `select permissions from user_group where key='user'`).Scan(&stored))
	var permissions []string
	require.NoError(t, json.Unmarshal(stored, &permissions))
	require.Empty(t, permissions)
}

// Catches a management read mixing versions or opening a writable transaction.
func TestGroupDefaultManagementReadSnapshot(t *testing.T) {
	f := groupDefaultFixture(t)
	require.NoError(t, f.s.inRead(t.Context(), func(q groupDefaultStore) error {
		before, err := q.GetUserGroupByKey(t.Context(), "user")
		require.NoError(t, err)
		_, err = f.pool.Exec(t.Context(), `update user_group set default_domain_id=$1,updated_at=clock_timestamp() where key='user'`, f.assigned)
		require.NoError(t, err)
		after, err := q.GetUserGroupByKey(t.Context(), "user")
		require.NoError(t, err)
		require.Equal(t, before, after)
		return nil
	}))
	err := f.s.inRead(t.Context(), func(q groupDefaultStore) error {
		_, err := q.SetUserGroupDefaultDomain(t.Context(), sqlc.SetUserGroupDefaultDomainParams{GroupKey: "user", DomainID: pgtype.UUID{}})
		return err
	})
	require.ErrorContains(t, err, "read-only transaction")
}

// Catches audit failure committing a group field/version or reporting a successful partial result.
func TestGroupDefaultAuditFailure(t *testing.T) {
	f := groupDefaultFixture(t)
	input := f.input(t, "user", &f.assigned)
	_, err := f.pool.Exec(t.Context(), `alter table audit_log add constraint group_default_failure check(false) not valid`)
	require.NoError(t, err)
	_, err = f.s.Set(t.Context(), f.actor, input)
	require.Error(t, err)
	var selected *string
	var at time.Time
	require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text,updated_at from user_group where key='user'`).Scan(&selected, &at))
	require.Nil(t, selected)
	require.Equal(t, input.ExpectedUpdatedAt, at.UTC().Format(time.RFC3339Nano))
}

// Catches unavailable IDs leaking to the current account and authorization trusting the supplied GroupKey.
func TestGroupDefaultCurrentSnapshotMasksUnavailable(t *testing.T) {
	f := groupDefaultFixture(t)
	_, err := f.s.Set(t.Context(), f.actor, f.input(t, "admin", &f.assigned))
	require.NoError(t, err)
	staleActor := f.actor
	staleActor.GroupKey = "user"
	result, err := f.s.GetCurrent(t.Context(), staleActor)
	require.NoError(t, err)
	require.Equal(t, "available", result.Selection.Status)
	require.Equal(t, &f.assigned, result.Selection.DomainID)
	_, err = f.pool.Exec(t.Context(), `update domain set enabled=false where id=$1`, f.assigned)
	require.NoError(t, err)
	result, err = f.s.GetCurrent(t.Context(), staleActor)
	require.NoError(t, err)
	require.Equal(t, "unavailable", result.Selection.Status)
	require.Nil(t, result.Selection.DomainID)
	_, err = f.pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, f.actor.ID)
	require.NoError(t, err)
	_, err = f.s.GetCurrent(t.Context(), staleActor)
	require.ErrorIs(t, err, ErrPermissionDenied)
}

// Catches cancellation while queued behind domain configuration committing a setting or audit later.
func TestGroupDefaultWriteCancellation(t *testing.T) {
	f := groupDefaultFixture(t)
	input := f.input(t, "user", &f.assigned)
	gate, err := f.pool.Begin(t.Context())
	require.NoError(t, err)
	t.Cleanup(func() { _ = gate.Rollback(context.Background()) })
	_, err = gate.Exec(t.Context(), `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := f.s.Set(ctx, f.actor, input); result <- err }()
	waitForPermissionWriterLock(t, t.Context(), f.pool)
	cancel()
	require.ErrorIs(t, awaitConfigurationResult(t, t.Context(), result), context.Canceled)
	require.NoError(t, gate.Rollback(t.Context()))
	var selected *string
	var at time.Time
	require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text,updated_at from user_group where key='user'`).Scan(&selected, &at))
	require.Nil(t, selected)
	require.Equal(t, input.ExpectedUpdatedAt, at.UTC().Format(time.RFC3339Nano))
	var audits int
	require.NoError(t, f.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&audits))
	require.Zero(t, audits)
}

// Catches two independent default actions both winning the same version or losing the selected reference.
func TestGroupDefaultConcurrentSaves(t *testing.T) {
	f := groupDefaultFixture(t)
	first := f.input(t, "user", &f.assigned)
	second := first
	second.DomainID = &f.global
	start, results := make(chan struct{}), make(chan error, 2)
	for _, input := range []SetDomainDefaultInput{first, second} {
		go func() { <-start; _, err := f.s.Set(t.Context(), f.actor, input); results <- err }()
	}
	close(start)
	wins, conflicts := 0, 0
	for range 2 {
		err := awaitConfigurationResult(t, t.Context(), results)
		if err == nil {
			wins++
		} else {
			require.ErrorIs(t, err, ErrPermissionConflict)
			conflicts++
		}
	}
	require.Equal(t, 1, wins)
	require.Equal(t, 1, conflicts)
	var selected string
	require.NoError(t, f.pool.QueryRow(t.Context(), `select default_domain_id::text from user_group where key='user'`).Scan(&selected))
	require.Contains(t, []string{f.global, f.assigned}, selected)
}

// Catches a changed global role bypassing current default/assigned permissions or destroying a recoverable setting.
func TestGroupDefaultCurrentDomainRoleChanges(t *testing.T) {
	f := groupDefaultFixture(t)
	_, err := f.s.Set(t.Context(), f.actor, f.input(t, "admin", &f.global))
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `update user_group set permissions=permissions-'domain:use_assigned' where key='admin'`)
	require.NoError(t, err)
	current, err := f.s.GetCurrent(t.Context(), f.actor)
	require.NoError(t, err)
	require.Equal(t, "available", current.Selection.Status)
	require.Equal(t, &f.global, current.Selection.DomainID)
	_, err = f.pool.Exec(t.Context(), `update domain set is_default=false where is_default`)
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `update domain set is_default=true where id=$1`, f.assigned)
	require.NoError(t, err)
	current, err = f.s.GetCurrent(t.Context(), f.actor)
	require.NoError(t, err)
	require.Equal(t, "unavailable", current.Selection.Status)
	require.Nil(t, current.Selection.DomainID)
	_, err = f.pool.Exec(t.Context(), `update user_group set permissions=permissions || '["domain:use_assigned"]' where key='admin'`)
	require.NoError(t, err)
	current, err = f.s.GetCurrent(t.Context(), f.actor)
	require.NoError(t, err)
	require.Equal(t, "available", current.Selection.Status)
	require.Equal(t, &f.global, current.Selection.DomainID)
}
