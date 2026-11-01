package usergroup

import (
	"context"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// Catches queued saves outliving completed account, group, grant or domain revocations.
func TestGroupDefaultWriteCurrentAuthorizationQueue(t *testing.T) {
	for _, scenario := range []struct {
		name, query string
		domainArg   bool
		want        error
	}{
		{"disabled actor", `update app_user set status='disabled' where id=$1`, false, ErrPermissionDenied},
		{"deleted actor", `update app_user set deleted_at=clock_timestamp() where id=$1`, false, ErrPermissionDenied},
		{"moved actor", `update app_user set group_id=(select id from user_group where key='user') where id=$1`, false, ErrPermissionDenied},
		{"admin access revoked", `update user_group set permissions=permissions-'admin:access' where key='admin' and exists(select 1 from app_user where id=$1)`, false, ErrPermissionDenied},
		{"domain manage revoked", `update user_group set permissions=permissions-'domain:manage' where key='admin' and exists(select 1 from app_user where id=$1)`, false, ErrPermissionDenied},
		{"admin no longer builtin", `update user_group set builtin=false where key='admin' and exists(select 1 from app_user where id=$1)`, false, ErrPermissionDenied},
		{"target no longer builtin", `update user_group set builtin=false where key='user' and exists(select 1 from app_user where id=$1)`, false, ErrUserGroupNotFound},
		{"creation revoked", `update user_group set permissions=permissions-'short_link:create' where key='user' and exists(select 1 from app_user where id=$1)`, false, ErrPermissionDenied},
		{"assigned use revoked", `update user_group set permissions=permissions-'domain:use_assigned' where key='user' and exists(select 1 from app_user where id=$1)`, false, ErrPermissionDenied},
		{"grant removed", `delete from domain_user_group where domain_id=$1 and user_group_id=(select id from user_group where key='user')`, true, ErrPermissionDenied},
		{"domain disabled", `update domain set enabled=false where id=$1`, true, ErrPermissionDenied},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f := groupDefaultFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			input := f.input(t, "user", &f.assigned)
			gate, err := f.pool.Begin(ctx)
			require.NoError(t, err)
			t.Cleanup(func() { testdb.Rollback(t, gate.Rollback) })
			_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() { _, err := f.s.Set(ctx, f.actor, input); result <- err }()
			waitForPermissionWriterLock(t, ctx, f.pool)
			argument := f.actor.ID
			if scenario.domainArg {
				argument = f.assigned
			}
			_, err = f.pool.Exec(ctx, scenario.query, argument)
			require.NoError(t, err)
			require.NoError(t, gate.Rollback(ctx))
			require.ErrorIs(t, awaitConfigurationResult(t, ctx, result), scenario.want)
			var selected *string
			var at time.Time
			require.NoError(t, f.pool.QueryRow(ctx, `select default_domain_id::text,updated_at from user_group where key='user'`).Scan(&selected, &at))
			require.Nil(t, selected)
			require.Equal(t, input.ExpectedUpdatedAt, at.UTC().Format(time.RFC3339Nano))
			var audits int
			require.NoError(t, f.pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&audits))
			require.Zero(t, audits)
		})
	}
}

// Catches a saved reference resurrecting a deleted domain or deadlocking either transaction order.
func TestGroupDefaultDeleteRace(t *testing.T) {
	for _, saveFirst := range []bool{false, true} {
		name := "delete_first"
		if saveFirst {
			name = "save_first"
		}
		t.Run(name, func(t *testing.T) {
			f := groupDefaultFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			input := f.input(t, "user", &f.assigned)
			var at time.Time
			require.NoError(t, f.pool.QueryRow(ctx, `select updated_at from domain where id=$1`, f.assigned).Scan(&at))
			deletion := domain.ChangeInput{ID: f.assigned, ExpectedUpdatedAt: at.UTC().Format(time.RFC3339Nano)}
			domains := domain.NewService(f.pool, permission.NewDatabaseService(f.pool))
			gate, err := f.pool.Begin(ctx)
			require.NoError(t, err)
			t.Cleanup(func() { testdb.Rollback(t, gate.Rollback) })
			if saveFirst {
				_, err = gate.Exec(ctx, `select id from user_group where key='user' for no key update`)
			} else {
				_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
			}
			require.NoError(t, err)
			saved, deleted := make(chan error, 1), make(chan error, 1)
			save := func() { _, err := f.s.Set(ctx, f.actor, input); saved <- err }
			remove := func() { deleted <- domains.Delete(ctx, f.actor, deletion) }
			if saveFirst {
				go save()
			} else {
				go remove()
			}
			waitForConfigurationLockWaiters(t, ctx, f.pool, 1)
			if saveFirst {
				go remove()
			} else {
				go save()
			}
			waitForConfigurationLockWaiters(t, ctx, f.pool, 2)
			require.NoError(t, gate.Rollback(ctx))
			saveErr := awaitConfigurationResult(t, ctx, saved)
			require.NoError(t, awaitConfigurationResult(t, ctx, deleted))
			if saveFirst {
				require.NoError(t, saveErr)
			} else {
				require.ErrorIs(t, saveErr, ErrPermissionDenied)
			}
			var exists bool
			var selected *string
			require.NoError(t, f.pool.QueryRow(ctx, `select exists(select 1 from domain where id=$1)`, f.assigned).Scan(&exists))
			require.False(t, exists)
			require.NoError(t, f.pool.QueryRow(ctx, `select default_domain_id::text from user_group where key='user'`).Scan(&selected))
			require.Nil(t, selected)
		})
	}
}

// Catches row/group lock inversion and saves authorized after a completed primary-group change.
func TestGroupDefaultMembershipRace(t *testing.T) {
	for _, saveFirst := range []bool{false, true} {
		name := "migration_first"
		if saveFirst {
			name = "save_first"
		}
		t.Run(name, func(t *testing.T) {
			f := groupDefaultFixture(t)
			ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
			defer cancel()
			manager := auth.CurrentUser{ID: uuid.NewString(), GroupKey: "admin"}
			_, err := f.pool.Exec(ctx, `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
				select $1,'migration-manager','Manager',id,'active',false,now(),now() from user_group where key='admin'`, manager.ID)
			require.NoError(t, err)
			var at time.Time
			require.NoError(t, f.pool.QueryRow(ctx, `select updated_at from app_user where id=$1`, f.actor.ID).Scan(&at))
			input := f.input(t, "user", &f.assigned)
			members := user.NewService(f.pool, permission.NewDatabaseService(f.pool))
			gate, err := f.pool.Begin(ctx)
			require.NoError(t, err)
			t.Cleanup(func() { testdb.Rollback(t, gate.Rollback) })
			if saveFirst {
				_, err = gate.Exec(ctx, `select id from user_group where key='user' for no key update`)
			} else {
				_, err = gate.Exec(ctx, `select id from app_user where id=$1 for update`, f.actor.ID)
			}
			require.NoError(t, err)
			saved, migrated := make(chan error, 1), make(chan error, 1)
			save := func() { _, err := f.s.Set(ctx, f.actor, input); saved <- err }
			migrate := func() {
				_, err := members.ChangeGroup(ctx, manager, user.ChangeGroupInput{ID: f.actor.ID, GroupKey: "user", ExpectedUpdatedAt: at.UTC().Format(time.RFC3339Nano)})
				migrated <- err
			}
			if saveFirst {
				go save()
			} else {
				go migrate()
			}
			waitForConfigurationLockWaiters(t, ctx, f.pool, 1)
			if saveFirst {
				go migrate()
			} else {
				go save()
			}
			waitForConfigurationLockWaiters(t, ctx, f.pool, 2)
			require.NoError(t, gate.Rollback(ctx))
			saveErr := awaitConfigurationResult(t, ctx, saved)
			require.NoError(t, awaitConfigurationResult(t, ctx, migrated))
			if saveFirst {
				require.NoError(t, saveErr)
			} else {
				require.ErrorIs(t, saveErr, ErrPermissionDenied)
			}
			var actual string
			require.NoError(t, f.pool.QueryRow(ctx, `select g.key from app_user u join user_group g on g.id=u.group_id where u.id=$1`, f.actor.ID).Scan(&actual))
			require.Equal(t, "user", actual)
		})
	}
}

// Catches a queued explicit choice using an obsolete default/assigned role after a real global switch.
func TestGroupDefaultQueuedGlobalSwitch(t *testing.T) {
	f := groupDefaultFixture(t)
	ctx, cancel := context.WithTimeout(t.Context(), 15*time.Second)
	defer cancel()
	_, err := f.pool.Exec(ctx, `update user_group set permissions=permissions-'domain:use_default' where key='user'`)
	require.NoError(t, err)
	input := f.input(t, "user", &f.assigned)
	var at time.Time
	require.NoError(t, f.pool.QueryRow(ctx, `select updated_at from domain where id=$1`, f.assigned).Scan(&at))
	gate, err := f.pool.Begin(ctx)
	require.NoError(t, err)
	t.Cleanup(func() { testdb.Rollback(t, gate.Rollback) })
	_, err = gate.Exec(ctx, `select id from domain where id=$1 for update`, f.assigned)
	require.NoError(t, err)
	domains := domain.NewService(f.pool, permission.NewDatabaseService(f.pool))
	switched, saved := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := domains.SetDefault(ctx, f.actor, domain.ChangeInput{ID: f.assigned, ExpectedUpdatedAt: at.UTC().Format(time.RFC3339Nano)})
		switched <- err
	}()
	waitForConfigurationLockWaiters(t, ctx, f.pool, 1)
	go func() { _, err := f.s.Set(ctx, f.actor, input); saved <- err }()
	waitForConfigurationLockWaiters(t, ctx, f.pool, 2)
	require.NoError(t, gate.Rollback(ctx))
	require.NoError(t, awaitConfigurationResult(t, ctx, switched))
	require.ErrorIs(t, awaitConfigurationResult(t, ctx, saved), ErrPermissionDenied)
	var selected *string
	require.NoError(t, f.pool.QueryRow(ctx, `select default_domain_id::text from user_group where key='user'`).Scan(&selected))
	require.Nil(t, selected)
}

// awaitConfigurationResult keeps a missing completion from hanging a transaction race indefinitely.
func awaitConfigurationResult(t *testing.T, ctx context.Context, result <-chan error) error {
	t.Helper()
	select {
	case err := <-result:
		return err
	case <-ctx.Done():
		t.Fatal("configuration transaction did not finish")
		return ctx.Err()
	}
}
