package insights_test

import (
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/loginpolicy"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/TomyJan/MoeURL/internal/usergroup"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// TestAuditMutationCoverage catches application writes that bypass actor-bound transactions.
func TestAuditMutationCoverage(t *testing.T) {
	pool, _, owner, admin, link, _ := fixture(t)
	ctx := t.Context()
	permissions := permission.NewDatabaseService(pool)
	assertLast := func(actor, resource, id, action string, fields []string) {
		t.Helper()
		var actualActor, actualResource, actualID, actualAction string
		var actualFields []string
		require.NoError(t, pool.QueryRow(ctx, `select actor_id::text,resource_type,resource_id,action,changed_fields from audit_log order by id desc limit 1`).Scan(&actualActor, &actualResource, &actualID, &actualAction, &actualFields))
		require.Equal(t, actor, actualActor)
		require.Equal(t, resource, actualResource)
		require.Equal(t, id, actualID)
		require.Equal(t, action, actualAction)
		require.ElementsMatch(t, fields, actualFields)
	}
	links := shortlink.NewService(pool, permissions)
	disabled, active, target := "disabled", "active", "https://changed.example/private"
	_, err := links.Update(ctx, owner, shortlink.UpdateInput{ID: link, Status: &disabled})
	require.NoError(t, err)
	assertLast(owner.ID, "short_link", link, "disable", []string{"status"})
	_, err = links.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: link, Status: &active, TargetURL: &target})
	require.NoError(t, err)
	assertLast(admin.ID, "short_link", link, "enable", []string{"status", "target_url"})
	_, err = links.Batch(ctx, owner, shortlink.BatchInput{IDs: []string{link}, Action: "disable"})
	require.NoError(t, err)
	assertLast(owner.ID, "short_link", link, "disable", []string{"status"})
	_, err = links.AdminBatch(ctx, admin, shortlink.BatchInput{IDs: []string{link}, Action: "enable"})
	require.NoError(t, err)
	assertLast(admin.ID, "short_link", link, "enable", []string{"status"})
	require.NoError(t, links.Delete(ctx, owner, shortlink.DeleteInput{ID: link}))
	assertLast(owner.ID, "short_link", link, "delete", []string{"deleted_at"})
	other := newLink(t, pool, owner.ID, "auditdelete", false)
	require.NoError(t, links.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: other}))
	assertLast(admin.ID, "short_link", other, "delete", []string{"deleted_at"})
	users := user.NewService(pool, permissions)
	created, err := users.Create(ctx, admin, user.CreateInput{Username: "audited", Nickname: "Private name", Password: "private-password", GroupKey: "user", Status: "active"})
	require.NoError(t, err)
	expectedCreateFields := []string{"username", "nickname", "group_id", "status", "password_hash", "deleted_at"}
	assertLast(admin.ID, "user", created.User.ID, "create", expectedCreateFields)
	_, err = users.Update(ctx, admin, user.UpdateInput{ID: created.User.ID, Nickname: "Changed", Status: "disabled"})
	require.NoError(t, err)
	assertLast(admin.ID, "user", created.User.ID, "disable", []string{"nickname", "status"})
	_, err = users.UpdateProfile(ctx, owner, user.UpdateProfileInput{Nickname: "New nickname"})
	require.NoError(t, err)
	assertLast(owner.ID, "user", owner.ID, "update", []string{"nickname"})
	require.NoError(t, users.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: created.User.ID, Password: "reset-secret"}))
	assertLast(admin.ID, "user", created.User.ID, "credential_change", []string{"password_hash"})
}

// TestAuditEveryMutationRollsBack forces audit uniqueness failure at each service write and compares persisted business snapshots.
func TestAuditEveryMutationRollsBack(t *testing.T) {
	pool, _, owner, admin, link, _ := fixture(t)
	ctx := t.Context()
	perms := permission.NewDatabaseService(pool)
	_, err := pool.Exec(ctx, `update domain set host='https://short.example'; insert into domain_user_group(domain_id,user_group_id) select domain.id,user_group.id from domain cross join user_group where user_group.key in ('user','admin')`)
	require.NoError(t, err)
	links := shortlink.NewService(pool, perms)
	users := user.NewService(pool, perms)
	domains := domain.NewService(pool, perms)
	groups := usergroup.NewService(pool, perms)
	settings := system.NewSettingsService(pool, perms, loginpolicy.NewService(pool, nil))
	d, err := domains.Create(ctx, admin, domain.CreateInput{Host: "https://second.example", DisplayName: "Second", Enabled: true, AllowedGroups: []string{"user"}})
	require.NoError(t, err)
	var groupUpdated time.Time
	require.NoError(t, pool.QueryRow(ctx, `select updated_at from user_group where key='user'`).Scan(&groupUpdated))
	current, err := settings.GetSettings(ctx, admin)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `create function fail_audit_write() returns trigger language plpgsql as $$ begin raise exception 'private failure' using errcode='23505',constraint='audit_injected'; end $$; create trigger fail_audit_write before insert on audit_log for each row execute function fail_audit_write()`)
	require.NoError(t, err)
	status := "disabled"
	operations := []struct {
		name string
		run  func() error
	}{
		{"short create", func() error {
			_, e := links.Create(ctx, owner, shortlink.CreateInput{TargetURL: "https://private.example", RedirectMode: "direct"})
			return e
		}},
		{"short update", func() error {
			_, e := links.Update(ctx, owner, shortlink.UpdateInput{ID: link, Status: &status})
			return e
		}},
		{"admin short update", func() error {
			_, e := links.AdminUpdate(ctx, admin, shortlink.UpdateInput{ID: link, Status: &status})
			return e
		}},
		{"short delete", func() error { return links.Delete(ctx, owner, shortlink.DeleteInput{ID: link}) }},
		{"admin short delete", func() error { return links.AdminDelete(ctx, admin, shortlink.DeleteInput{ID: link}) }},
		{"short batch", func() error {
			_, e := links.Batch(ctx, owner, shortlink.BatchInput{IDs: []string{link}, Action: "disable"})
			return e
		}},
		{"admin short batch", func() error {
			_, e := links.AdminBatch(ctx, admin, shortlink.BatchInput{IDs: []string{link}, Action: "delete"})
			return e
		}},
		{"user create", func() error {
			_, e := users.Create(ctx, admin, user.CreateInput{Username: "new-audit", Nickname: "Private", Password: "private-secret", GroupKey: "user", Status: "active"})
			return e
		}},
		{"user update", func() error {
			_, e := users.Update(ctx, admin, user.UpdateInput{ID: owner.ID, Nickname: "Private", Status: "disabled"})
			return e
		}},
		{"profile", func() error {
			_, e := users.UpdateProfile(ctx, owner, user.UpdateProfileInput{Nickname: "Private"})
			return e
		}},
		{"reset", func() error {
			return users.ResetPassword(ctx, admin, user.ResetPasswordInput{ID: owner.ID, Password: "private-secret"})
		}},
		{"permissions", func() error {
			_, e := groups.UpdatePermissions(ctx, admin, usergroup.UpdatePermissionsInput{GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: groupUpdated.Format(time.RFC3339Nano)})
			return e
		}},
		{"domain create", func() error {
			_, e := domains.Create(ctx, admin, domain.CreateInput{Host: "https://third.example", DisplayName: "Third", Enabled: true, AllowedGroups: []string{}})
			return e
		}},
		{"domain update", func() error {
			_, e := domains.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: "Changed", Enabled: true, AllowedGroups: []string{"admin"}})
			return e
		}},
		{"domain default", func() error {
			_, e := domains.SetDefault(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
			return e
		}},
		{"domain delete", func() error {
			return domains.Delete(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
		}},
		{"settings", func() error {
			_, e := settings.UpdateSettings(ctx, admin, system.UpdateSettingsInput{SiteName: "Private", DefaultLanguage: current.DefaultLanguage, DefaultTheme: current.DefaultTheme, FooterText: current.FooterText, ShowPoweredBy: true, LocalLoginEnabled: true, ExpectedUpdatedAt: current.UpdatedAt})
			return e
		}},
	}
	snapshot := func() []string {
		result := []string{}
		for _, table := range []string{"short_link", "app_user", "user_group", "domain", "domain_user_group", "system_setting", "audit_log"} {
			var data string
			require.NoError(t, pool.QueryRow(ctx, `select coalesce(jsonb_agg(x order by x::text),'[]')::text from (select to_jsonb(t) x from `+table+` t) rows`).Scan(&data))
			result = append(result, data)
		}
		return result
	}
	for _, op := range operations {
		t.Run(op.name, func(t *testing.T) {
			before := snapshot()
			err := op.run()
			require.Error(t, err)
			var databaseError *pgconn.PgError
			require.ErrorAs(t, err, &databaseError)
			require.Equal(t, "audit_injected", databaseError.ConstraintName, "the operation must reach the audit write")
			require.NotErrorIs(t, err, user.ErrUsernameExists)
			require.NotErrorIs(t, err, domain.ErrDomainConflict)
			require.Equal(t, before, snapshot())
		})
	}
	_, err = pool.Exec(ctx, `drop trigger fail_audit_write on audit_log`)
	require.NoError(t, err)
	created, err := links.Create(ctx, owner, shortlink.CreateInput{TargetURL: "https://private.example", RedirectMode: "direct"})
	require.NoError(t, err)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and action='create' and actor_id=$2`, created.ShortLink.ID, owner.ID).Scan(&count))
	require.Equal(t, 1, count)
	_, err = groups.UpdatePermissions(ctx, admin, usergroup.UpdatePermissionsInput{GroupKey: "user", Permissions: []string{}, ExpectedUpdatedAt: groupUpdated.Format(time.RFC3339Nano)})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_type='user_group' and action='permissions_change' and changed_fields=array['permissions'] and actor_id=$1`, admin.ID).Scan(&count))
	require.Equal(t, 1, count)
	_, err = settings.UpdateSettings(ctx, admin, system.UpdateSettingsInput{SiteName: "Changed site", DefaultLanguage: current.DefaultLanguage, DefaultTheme: current.DefaultTheme, FooterText: current.FooterText, ShowPoweredBy: true, LocalLoginEnabled: true, ExpectedUpdatedAt: current.UpdatedAt})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='system_setting' and resource_id='site.name' and action='settings_change' and changed_fields=array['site.name']`, admin.ID).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAuditNoopAndSecretExclusion verifies maintenance-only fields and unchanged business values do not write audit noise.
func TestAuditNoopAndSecretExclusion(t *testing.T) {
	pool, _, owner, _, link, _ := fixture(t)
	ctx := t.Context()
	_, err := pool.Exec(ctx, `update short_link set max_visits=10 where id=$1`, link)
	require.NoError(t, err)
	err = appdb.WithAuditTx(ctx, pool, owner.ID, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `update short_link set updated_at=now(),visits_used=visits_used+1 where id=$1`, link)
		return err
	})
	require.NoError(t, err)
	var count int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Zero(t, count)
	target := "https://private.example/secret-token"
	_, err = shortlink.NewService(pool, permission.NewDatabaseService(pool)).Update(ctx, owner, shortlink.UpdateInput{ID: link, TargetURL: &target, Password: &shortlink.PasswordInput{Mode: "set", Value: "private-access-password"}})
	require.NoError(t, err)
	var logs string
	require.NoError(t, pool.QueryRow(ctx, `select jsonb_agg(audit_log)::text from audit_log`).Scan(&logs))
	require.NotContains(t, logs, "private.example")
	require.NotContains(t, logs, "private-access-password")
	require.NotContains(t, logs, "argon2")
	_, err = shortlink.NewService(pool, permission.NewDatabaseService(pool)).Update(ctx, owner, shortlink.UpdateInput{ID: link})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestSetupAuditRollback records explicit system actors and preserves an uninitialized database after audit failure.
func TestSetupAuditRollback(t *testing.T) {
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	ctx := t.Context()
	policy, err := system.NewSetupPolicy(false, "")
	require.NoError(t, err)
	service := system.NewService(pool, policy)
	input := system.SetupInput{AdminUsername: "admin", AdminPassword: "private-password", AdminNickname: "Private", SiteName: "Site", SystemDomain: "https://console.example", ShortLinkDomain: "https://s.example", DefaultLanguage: "en", DefaultTheme: "system"}
	_, err = pool.Exec(ctx, `alter table audit_log add constraint audit_failure check(false) not valid`)
	require.NoError(t, err)
	require.Error(t, service.Setup(ctx, input))
	var count int
	for _, table := range []string{"app_user", "user_group", "domain", "audit_log"} {
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from `+table).Scan(&count))
		require.Zero(t, count)
	}
	_, err = pool.Exec(ctx, `alter table audit_log drop constraint audit_failure`)
	require.NoError(t, err)
	require.NoError(t, service.Setup(ctx, input))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id is not null`).Scan(&count))
	require.Zero(t, count)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_type='system_setting' and resource_id='site.name' and changed_fields=array['site.name']`).Scan(&count))
	require.Equal(t, 1, count)
}

// TestAuditBatchSecondRowFailure proves a successful first row and its log cannot survive a later audit failure.
func TestAuditBatchSecondRowFailure(t *testing.T) {
	pool, _, owner, admin, link, _ := fixture(t)
	ctx := t.Context()
	second := newLink(t, pool, owner.ID, "auditbatchsecond", false)
	_, err := pool.Exec(ctx, `create function reject_second_audit() returns trigger language plpgsql as $$ begin if exists(select 1 from audit_log where resource_type='short_link') then raise exception 'second audit failed'; end if; return new; end $$; create trigger reject_second_audit before insert on audit_log for each row execute function reject_second_audit()`)
	require.NoError(t, err)
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	for _, action := range []string{"disable", "delete"} {
		_, err = service.AdminBatch(ctx, admin, shortlink.BatchInput{IDs: []string{link, second}, Action: action})
		require.Error(t, err)
		var count int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where status='active' and deleted_at is null`).Scan(&count))
		require.Equal(t, 2, count)
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&count))
		require.Zero(t, count)
	}
}

// TestDomainGrantAuditDiff catches delete-and-reinsert grant noise and missing domain actors.
func TestDomainGrantAuditDiff(t *testing.T) {
	pool, _, _, admin, _, _ := fixture(t)
	ctx := t.Context()
	service := domain.NewService(pool, permission.NewDatabaseService(pool))
	d, err := service.Create(ctx, admin, domain.CreateInput{Host: "https://audit.example", DisplayName: "Audit", Enabled: true, AllowedGroups: []string{"user", "admin"}})
	require.NoError(t, err)
	count := func() int {
		var n int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and action='assignment_change' and actor_id=$2`, d.ID, admin.ID).Scan(&n))
		return n
	}
	require.Equal(t, 2, count())
	d, err = service.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: "Renamed", Enabled: true, AllowedGroups: []string{"admin", "user"}})
	require.NoError(t, err)
	require.Equal(t, 2, count())
	d, err = service.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: d.DisplayName, Enabled: true, AllowedGroups: []string{"admin"}})
	require.NoError(t, err)
	require.Equal(t, 3, count())
	var before int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&before))
	d, err = service.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: d.DisplayName, Enabled: true, AllowedGroups: []string{"admin"}})
	require.NoError(t, err)
	var after int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&after))
	require.Equal(t, before, after)
	d, err = service.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: d.DisplayName, Enabled: false, AllowedGroups: []string{"admin"}})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and actor_id=$2 and action='disable' and changed_fields=array['enabled']`, d.ID, admin.ID).Scan(&after))
	require.Equal(t, 1, after)
	d, err = service.Update(ctx, admin, domain.UpdateInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt, Host: d.Host, DisplayName: d.DisplayName, Enabled: true, AllowedGroups: []string{"admin"}})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and actor_id=$2 and action='enable' and changed_fields=array['enabled']`, d.ID, admin.ID).Scan(&after))
	require.Equal(t, 1, after)
	d, err = service.SetDefault(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
	require.NoError(t, err)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where actor_id=$1 and resource_type='domain' and action='update' and changed_fields=array['is_default']`, admin.ID).Scan(&after))
	require.Equal(t, 2, after)
	candidate, err := service.Create(ctx, admin, domain.CreateInput{Host: "https://delete.example", DisplayName: "Delete", Enabled: true, AllowedGroups: []string{}})
	require.NoError(t, err)
	require.NoError(t, service.Delete(ctx, admin, domain.ChangeInput{ID: candidate.ID, ExpectedUpdatedAt: candidate.UpdatedAt}))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log where resource_id=$1 and actor_id=$2 and action='delete'`, candidate.ID, admin.ID).Scan(&after))
	require.Equal(t, 1, after)
}
