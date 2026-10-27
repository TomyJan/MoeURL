package domain_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestDomainRedirectDefaultSaveAndLegacyWrites catches silent version overwrites,
// no-op audit noise and old complete domain commands erasing the new setting.
func TestDomainRedirectDefaultSaveAndLegacyWrites(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	ctx := t.Context()
	input := domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt}
	saved, err := s.SetRedirectDefault(ctx, admin, input)
	require.NoError(t, err)
	require.Equal(t, "confirmation", saved.RedirectMode)
	require.NotEqual(t, d.UpdatedAt, saved.UpdatedAt)
	count := func() int {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and changed_fields=array['default_redirect_mode']`, d.ID).Scan(&n))
		return n
	}
	require.Equal(t, 1, count())
	input.ExpectedUpdatedAt = saved.UpdatedAt
	same, err := s.SetRedirectDefault(ctx, admin, input)
	require.NoError(t, err)
	require.Equal(t, saved, same)
	require.Equal(t, 1, count())
	input.ExpectedUpdatedAt = d.UpdatedAt
	_, err = s.SetRedirectDefault(ctx, admin, input)
	require.ErrorIs(t, err, domain.ErrVersionConflict)
	require.Equal(t, 1, count())
	updated, err := s.Update(ctx, admin, domain.UpdateInput{ID: d.ID, Host: d.Host, DisplayName: "New name", AllowedGroups: d.AllowedGroups, Enabled: true, ExpectedUpdatedAt: saved.UpdatedAt})
	require.NoError(t, err)
	updated, err = s.SetOrder(ctx, admin, domain.SetOrderInput{ID: d.ID, SortOrder: -7, ExpectedUpdatedAt: updated.UpdatedAt})
	require.NoError(t, err)
	updated, err = s.SetDefault(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: updated.UpdatedAt})
	require.NoError(t, err)
	current, err := s.GetRedirectDefault(ctx, admin, d.ID)
	require.NoError(t, err)
	require.Equal(t, "confirmation", current.RedirectMode)
	require.Equal(t, updated.UpdatedAt, current.UpdatedAt)
	require.Equal(t, 1, count())
}

// TestDomainRedirectDefaultInputBoundaries catches noncanonical actors and
// calendar-validity checks being lost behind syntactically complete revisions.
func TestDomainRedirectDefaultInputBoundaries(t *testing.T) {
	s, _, admin, _, d := orderFixture(t)
	valid := domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "direct", ExpectedUpdatedAt: d.UpdatedAt}
	_, err := s.SetRedirectDefault(t.Context(), auth.CurrentUser{ID: "not-a-uuid", GroupKey: "admin"}, valid)
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	_, err = s.GetRedirectDefault(t.Context(), admin, "not-a-uuid")
	require.ErrorIs(t, err, domain.ErrInvalidInput)
	_, err = s.RedirectDefaults(t.Context(), auth.CurrentUser{ID: "not-a-uuid"})
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	for _, version := range []string{"0001-01-01T00:00:00Z", "2026-02-30T00:00:00Z", "2026-10-28T01:02:03.1234567890Z"} {
		input := valid
		input.ExpectedUpdatedAt = version
		_, err := s.SetRedirectDefault(t.Context(), admin, input)
		require.ErrorIs(t, err, domain.ErrInvalidInput)
	}
	input := valid
	input.ID = uuid.NewString()
	_, err = s.SetRedirectDefault(t.Context(), admin, input)
	require.ErrorIs(t, err, domain.ErrDomainNotFound)
}

// TestDomainRedirectDefaultCancellation catches a queued domain write ignoring
// cancellation or leaving data changed after its audit transaction is rolled back.
func TestDomainRedirectDefaultCancellation(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	ctx := t.Context()
	gate, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = gate.Rollback(context.Background()) }()
	_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
	require.NoError(t, err)
	queued, cancel := context.WithCancel(ctx)
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, writeErr := s.SetRedirectDefault(queued, admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
		result <- writeErr
	}()
	waitForDomainLockWaiters(t, pool, 1)
	cancel()
	require.ErrorIs(t, <-result, context.Canceled)
	require.NoError(t, gate.Rollback(ctx))
	current, err := s.GetRedirectDefault(ctx, admin, d.ID)
	require.NoError(t, err)
	require.Equal(t, "direct", current.RedirectMode)
	require.Equal(t, d.UpdatedAt, current.UpdatedAt)
}

// TestDomainRedirectDefaultDeletedWhileQueued catches a cached target surviving
// deletion that commits before the queued command obtains the domain write lock.
func TestDomainRedirectDefaultDeletedWhileQueued(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	ctx := t.Context()
	gate, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = gate.Rollback(context.Background()) }()
	_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
	require.NoError(t, err)
	result := make(chan error, 1)
	go func() {
		_, err := s.SetRedirectDefault(ctx, admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
		result <- err
	}()
	waitForDomainLockWaiters(t, pool, 1)
	_, err = gate.Exec(ctx, `delete from domain where id=$1`, d.ID)
	require.NoError(t, err)
	require.NoError(t, gate.Commit(ctx))
	require.ErrorIs(t, <-result, domain.ErrDomainNotFound)
	var changes int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and changed_fields=array['default_redirect_mode']`, d.ID).Scan(&changes))
	require.Zero(t, changes)
}

// TestDomainRedirectDefaultCancelledRowUpdate catches zero-row CAS results
// becoming successful saves even when a database trigger prevented persistence.
func TestDomainRedirectDefaultCancelledRowUpdate(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	_, err := pool.Exec(t.Context(), `create function cancel_mode29_update() returns trigger language plpgsql as $$ begin return null; end $$;
        create trigger cancel_mode29 before update of default_redirect_mode on domain for each row execute function cancel_mode29_update()`)
	require.NoError(t, err)
	_, err = s.SetRedirectDefault(t.Context(), admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
	require.ErrorIs(t, err, domain.ErrVersionConflict)
	current, err := s.GetRedirectDefault(t.Context(), admin, d.ID)
	require.NoError(t, err)
	require.Equal(t, "direct", current.RedirectMode)
	require.Equal(t, d.UpdatedAt, current.UpdatedAt)
}

// TestDomainRedirectDefaultReadFailures catches infrastructure faults being
// relabeled as permission denial, empty success or an invented direct setting.
func TestDomainRedirectDefaultReadFailures(t *testing.T) {
	for _, stage := range []string{"actor_read", "permission_parse", "domain_read", "stored_mode", "begin"} {
		t.Run(stage, func(t *testing.T) {
			s, pool, admin, user, d := orderFixture(t)
			ctx := t.Context()
			var err error
			switch stage {
			case "actor_read":
				_, err = pool.Exec(ctx, `alter table app_user rename column status to missing_status`)
			case "permission_parse":
				_, err = pool.Exec(ctx, `update user_group set permissions='{}'::jsonb`)
			case "domain_read":
				_, err = pool.Exec(ctx, `alter table domain rename column default_redirect_mode to missing_mode`)
			case "stored_mode":
				_, err = pool.Exec(ctx, `alter table domain drop constraint domain_default_redirect_mode_check`)
				require.NoError(t, err)
				_, err = pool.Exec(ctx, `update domain set default_redirect_mode='bogus' where id=$1`, d.ID)
			case "begin":
				pool.Close()
			}
			require.NoError(t, err)
			setting, err := s.GetRedirectDefault(ctx, admin, d.ID)
			require.Error(t, err)
			require.NotErrorIs(t, err, domain.ErrPermissionDenied)
			require.Empty(t, setting)
			items, err := s.RedirectDefaults(ctx, user)
			require.Error(t, err)
			require.NotErrorIs(t, err, domain.ErrPermissionDenied)
			require.Nil(t, items)
		})
	}
}

// TestEffectiveDomainRedirectDefaults catches a stale actor group bypassing current
// grants, a configured mode granting permission and unavailable domain identifiers leaking.
func TestEffectiveDomainRedirectDefaults(t *testing.T) {
	s, pool, admin, user, d := orderFixture(t)
	ctx := t.Context()
	_, err := s.SetRedirectDefault(ctx, admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
	require.NoError(t, err)
	modes := func() map[string]string {
		result, err := s.RedirectDefaults(ctx, auth.CurrentUser{ID: user.ID, GroupKey: "admin"})
		require.NoError(t, err)
		actual := map[string]string{}
		for _, item := range result {
			actual[item.DomainID] = item.RedirectMode
		}
		return actual
	}
	require.Equal(t, "direct", modes()[d.ID])
	_, err = pool.Exec(ctx, `update user_group set permissions=permissions || '["short_link:use_confirmation"]'::jsonb where key='user'`)
	require.NoError(t, err)
	require.Equal(t, "confirmation", modes()[d.ID])
	_, err = pool.Exec(ctx, `update user_group set permissions=permissions-'domain:use_assigned' where key='user'`)
	require.NoError(t, err)
	require.NotContains(t, modes(), d.ID)
	_, err = pool.Exec(ctx, `update user_group set permissions=permissions || '["domain:use_assigned"]'::jsonb where key='user'`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `update domain set enabled=false where id=$1`, d.ID)
	require.NoError(t, err)
	require.NotContains(t, modes(), d.ID)
	_, err = pool.Exec(ctx, `update domain set enabled=true where id=$1`, d.ID)
	require.NoError(t, err)
	require.Equal(t, "confirmation", modes()[d.ID])
	_, err = pool.Exec(ctx, `delete from domain_user_group where domain_id=$1 and user_group_id=(select id from user_group where key='user')`, d.ID)
	require.NoError(t, err)
	require.NotContains(t, modes(), d.ID)
	_, err = pool.Exec(ctx, `update user_group set permissions='[]'::jsonb where key='user'`)
	require.NoError(t, err)
	require.Empty(t, modes())
	_, err = s.GetRedirectDefault(ctx, user, d.ID)
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	_, err = s.SetRedirectDefault(ctx, auth.CurrentUser{ID: user.ID, GroupKey: "admin"}, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "direct", ExpectedUpdatedAt: d.UpdatedAt})
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	_, err = pool.Exec(ctx, `update app_user set status='disabled' where id=$1`, user.ID)
	require.NoError(t, err)
	_, err = s.RedirectDefaults(ctx, user)
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
}

// TestDomainRedirectDefaultReauthorization catches a queued command retaining
// authority that was revoked before it acquired the shared domain write boundary.
func TestDomainRedirectDefaultReauthorization(t *testing.T) {
	for _, change := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"moved", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"revoked", `update user_group set permissions='["admin:access"]' where id=(select group_id from app_user where id=$1)`},
	} {
		t.Run(change.name, func(t *testing.T) {
			s, pool, admin, _, d := orderFixture(t)
			ctx := t.Context()
			gate, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = gate.Rollback(context.Background()) }()
			_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() {
				_, writeErr := s.SetRedirectDefault(ctx, admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
				result <- writeErr
			}()
			waitForDomainLockWaiters(t, pool, 1)
			_, err = pool.Exec(ctx, change.sql, admin.ID)
			require.NoError(t, err)
			require.NoError(t, gate.Commit(ctx))
			require.ErrorIs(t, <-result, domain.ErrPermissionDenied)
			var mode string
			var revision time.Time
			require.NoError(t, pool.QueryRow(ctx, `select default_redirect_mode,updated_at from domain where id=$1`, d.ID).Scan(&mode, &revision))
			require.Equal(t, "direct", mode)
			expected, err := time.Parse(time.RFC3339Nano, d.UpdatedAt)
			require.NoError(t, err)
			require.True(t, expected.Equal(revision), "revoked command must not advance the full database revision")
		})
	}
}

// TestDomainRedirectDefaultAuditRollback catches business state surviving either
// an immediate audit insertion failure or a deferred audit failure at commit.
func TestDomainRedirectDefaultAuditRollback(t *testing.T) {
	for _, deferred := range []bool{false, true} {
		t.Run(fmt.Sprint(deferred), func(t *testing.T) {
			s, pool, admin, _, d := orderFixture(t)
			ctx := t.Context()
			_, err := pool.Exec(ctx, `create function fail_mode29_audit() returns trigger language plpgsql as $$
                begin if NEW.changed_fields=array['default_redirect_mode'] then raise exception 'controlled mode audit fault'; end if; return NEW; end $$`)
			require.NoError(t, err)
			command := `create trigger fail_mode29 before insert on audit_log for each row execute function fail_mode29_audit()`
			if deferred {
				command = `create constraint trigger fail_mode29 after insert on audit_log deferrable initially deferred for each row execute function fail_mode29_audit()`
			}
			_, err = pool.Exec(ctx, command)
			require.NoError(t, err)
			_, err = s.SetRedirectDefault(ctx, admin, domain.SetRedirectDefaultInput{ID: d.ID, RedirectMode: "confirmation", ExpectedUpdatedAt: d.UpdatedAt})
			require.Error(t, err)
			current, err := s.GetRedirectDefault(ctx, admin, d.ID)
			require.NoError(t, err)
			require.Equal(t, "direct", current.RedirectMode)
			require.Equal(t, d.UpdatedAt, current.UpdatedAt)
			var count int
			require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and changed_fields=array['default_redirect_mode']`, d.ID).Scan(&count))
			require.Zero(t, count)
		})
	}
}
