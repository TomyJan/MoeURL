package system_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/loginpolicy"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TestSettingsServiceReadsPublicAndAdministrativeViews verifies safe defaults and field separation.
func TestSettingsServiceReadsPublicAndAdministrativeViews(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	service := system.NewSettingsService(pool, permission.NewService(), &settingsPolicyStub{})

	public, err := service.PublicConfig(ctx)
	if err != nil {
		t.Fatalf("read public settings: %v", err)
	}
	if public.SiteName != "MoeURL" || public.DefaultLanguage != "zh-CN" || public.DefaultTheme != "system" || public.FooterText != "" || !public.ShowPoweredBy {
		t.Fatalf("public defaults = %#v", public)
	}
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	settings, err := service.GetSettings(ctx, admin)
	if err != nil {
		t.Fatalf("read administrative settings: %v", err)
	}
	if !settings.LocalLoginEnabled || settings.UpdatedAt == "" {
		t.Fatalf("administrative settings = %#v", settings)
	}
}

// TestSettingsServiceValidateStartup verifies startup accepts canonical settings and rejects persisted corruption.
func TestSettingsServiceValidateStartup(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	service := system.NewSettingsService(pool, permission.NewService(), &settingsPolicyStub{})

	if err := service.ValidateStartup(ctx); err != nil {
		t.Fatalf("validate canonical startup settings: %v", err)
	}
	if _, err := pool.Exec(ctx, `update system_setting set value = '"fr"'::jsonb where key = 'site.default_language'`); err != nil {
		t.Fatalf("corrupt startup setting: %v", err)
	}
	if err := service.ValidateStartup(ctx); !errors.Is(err, system.ErrCorruptSettings) {
		t.Fatalf("validate corrupt startup settings error = %v", err)
	}
}

// TestSettingsServiceRequiresBothManagementPermissions verifies authorization is enforced in the service.
func TestSettingsServiceRequiresBothManagementPermissions(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	for _, test := range []struct {
		name        string
		permissions []string
	}{
		{name: "none"},
		{name: "admin only", permissions: []string{permission.AdminAccess}},
		{name: "system only", permissions: []string{permission.SystemManage}},
	} {
		t.Run(test.name, func(t *testing.T) {
			resolver := permission.NewServiceWithPermissions(nil, test.permissions)
			service := system.NewSettingsService(pool, resolver, &settingsPolicyStub{})
			if _, err := service.GetSettings(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}); !errors.Is(err, system.ErrSettingsPermissionDenied) {
				t.Fatalf("get settings error = %v", err)
			}
		})
	}
}

// TestSettingsServiceUpdatesAtomicallyAndDetectsConflicts verifies complete optimistic updates.
func TestSettingsServiceUpdatesAtomicallyAndDetectsConflicts(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	seedEditableSettings(t, ctx, pool)
	policy := &settingsPolicyStub{}
	service := system.NewSettingsService(pool, permission.NewService(), policy)
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	current, err := service.GetSettings(ctx, admin)
	if err != nil {
		t.Fatalf("read current settings: %v", err)
	}
	input := system.UpdateSettingsInput{
		SiteName: "  新站点  ", DefaultLanguage: "en", DefaultTheme: "dark",
		FooterText: "  Footer  ", ShowPoweredBy: false, LocalLoginEnabled: false,
		ExpectedUpdatedAt: current.UpdatedAt,
	}
	updated, err := service.UpdateSettings(ctx, admin, input)
	if err != nil {
		t.Fatalf("update settings: %v", err)
	}
	if updated.SiteName != "新站点" || updated.FooterText != "Footer" || updated.DefaultLanguage != "en" || updated.DefaultTheme != "dark" || updated.ShowPoweredBy || updated.LocalLoginEnabled {
		t.Fatalf("updated settings = %#v", updated)
	}
	if updated.UpdatedAt == current.UpdatedAt || policy.lockCalls != 1 || policy.requireCalls != 1 {
		t.Fatalf("updatedAt=%q lockCalls=%d requireCalls=%d", updated.UpdatedAt, policy.lockCalls, policy.requireCalls)
	}
	second := input
	second.SiteName = "再次保存"
	second.ExpectedUpdatedAt = updated.UpdatedAt
	resaved, err := service.UpdateSettings(ctx, admin, second)
	if err != nil {
		t.Fatalf("update settings with returned revision: %v", err)
	}
	if resaved.SiteName != second.SiteName || resaved.UpdatedAt == updated.UpdatedAt {
		t.Fatalf("resaved settings = %#v", resaved)
	}
	if _, err := service.UpdateSettings(ctx, admin, input); !errors.Is(err, system.ErrSettingsConflict) {
		t.Fatalf("stale update error = %v", err)
	}
}

// TestSettingsServiceRejectsInvalidInputBeforeTransaction verifies validation is side-effect free.
func TestSettingsServiceRejectsInvalidInputBeforeTransaction(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	policy := &settingsPolicyStub{}
	service := system.NewSettingsService(pool, permission.NewService(), policy)
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	for _, input := range []system.UpdateSettingsInput{
		{SiteName: "", DefaultLanguage: "en", DefaultTheme: "system", ExpectedUpdatedAt: time.Now().Format(time.RFC3339Nano)},
		{SiteName: "MoeURL", DefaultLanguage: "fr", DefaultTheme: "system", ExpectedUpdatedAt: time.Now().Format(time.RFC3339Nano)},
		{SiteName: "MoeURL", DefaultLanguage: "en", DefaultTheme: "blue", ExpectedUpdatedAt: time.Now().Format(time.RFC3339Nano)},
		{SiteName: "MoeURL", DefaultLanguage: "en", DefaultTheme: "system", FooterText: strings.Repeat("界", 201), ExpectedUpdatedAt: time.Now().Format(time.RFC3339Nano)},
		{SiteName: "MoeURL", DefaultLanguage: "en", DefaultTheme: "system", ExpectedUpdatedAt: "invalid"},
	} {
		if _, err := service.UpdateSettings(ctx, admin, input); !errors.Is(err, system.ErrInvalidSettings) {
			t.Fatalf("invalid input %#v error = %v", input, err)
		}
	}
	if policy.lockCalls != 0 {
		t.Fatalf("invalid inputs acquired policy lock %d times", policy.lockCalls)
	}
}

// TestSettingsServicePropagatesTransactionalAndStorageFailures verifies failed writes never report success.
func TestSettingsServicePropagatesTransactionalAndStorageFailures(t *testing.T) {
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	for _, test := range []struct {
		name    string
		prepare func(context.Context, *testing.T, *pgxpool.Pool) system.SettingsLoginPolicy
	}{
		{name: "nil policy", prepare: func(context.Context, *testing.T, *pgxpool.Pool) system.SettingsLoginPolicy { return nil }},
		{name: "lock failure", prepare: func(context.Context, *testing.T, *pgxpool.Pool) system.SettingsLoginPolicy {
			return &settingsPolicyStub{lockErr: errors.New("lock failed")}
		}},
		{name: "missing revision", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) system.SettingsLoginPolicy {
			if _, err := pool.Exec(ctx, `delete from system_setting where key = 'site.settings_revision'`); err != nil {
				t.Fatal(err)
			}
			return &settingsPolicyStub{}
		}},
		{name: "missing editable row", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) system.SettingsLoginPolicy {
			if _, err := pool.Exec(ctx, `delete from system_setting where key = 'site.footer_text'`); err != nil {
				t.Fatal(err)
			}
			return &settingsPolicyStub{}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			pool := systemTestPool(t, ctx)
			seedEditableSettings(t, ctx, pool)
			before := currentRevision(t, ctx, pool)
			policy := test.prepare(ctx, t, pool)
			service := system.NewSettingsService(pool, permission.NewService(), policy)
			input := system.UpdateSettingsInput{SiteName: "Changed", DefaultLanguage: "en", DefaultTheme: "system", ShowPoweredBy: true, LocalLoginEnabled: true, ExpectedUpdatedAt: before}
			if _, err := service.UpdateSettings(ctx, admin, input); err == nil {
				t.Fatal("expected settings update failure")
			}
		})
	}
}

// TestSettingsServiceHandlesReadFailures verifies corrupt or unavailable storage fails closed.
func TestSettingsServiceHandlesReadFailures(t *testing.T) {
	for _, test := range []struct {
		name    string
		prepare func(context.Context, *testing.T, *pgxpool.Pool)
		want    error
	}{
		{name: "query failure", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `drop table system_setting`)
			if err != nil {
				t.Fatal(err)
			}
		}},
		{name: "corrupt value", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `update system_setting set value = '"bad"'::jsonb where key = 'site.show_powered_by'`)
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
		{name: "null value", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `update system_setting set value = 'null'::jsonb where key = 'site.footer_text'`)
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
		{name: "unsupported value", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `update system_setting set value = '"fr"'::jsonb where key = 'site.default_language'`)
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
		{name: "invalid revision value", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, "update system_setting set value = '0'::jsonb where key = 'site.settings_revision'")
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
		{name: "missing editable value", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `delete from system_setting where key = 'site.footer_text'`)
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
		{name: "missing revision", prepare: func(ctx context.Context, t *testing.T, pool *pgxpool.Pool) {
			_, err := pool.Exec(ctx, `delete from system_setting where key = 'site.settings_revision'`)
			if err != nil {
				t.Fatal(err)
			}
		}, want: system.ErrCorruptSettings},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			pool := systemTestPool(t, ctx)
			test.prepare(ctx, t, pool)
			service := system.NewSettingsService(pool, permission.NewService(), &settingsPolicyStub{})
			_, err := service.PublicConfig(ctx)
			if err == nil || (test.want != nil && !errors.Is(err, test.want)) {
				t.Fatalf("read settings error = %v, want %v", err, test.want)
			}
		})
	}
}

// TestSettingsServiceCoversAuthorizationFailures verifies nil and failing resolvers are not bypassed.
func TestSettingsServiceCoversAuthorizationFailures(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
	if _, err := system.NewSettingsService(pool, nil, &settingsPolicyStub{}).UpdateSettings(ctx, admin, system.UpdateSettingsInput{}); !errors.Is(err, system.ErrSettingsPermissionDenied) {
		t.Fatalf("nil resolver error = %v", err)
	}
	resolverErr := errors.New("resolver failed")
	if _, err := system.NewSettingsService(pool, failingPermissionResolver{err: resolverErr}, &settingsPolicyStub{}).GetSettings(ctx, admin); !errors.Is(err, resolverErr) {
		t.Fatalf("resolver error = %v", err)
	}
}

// TestSettingsServiceAdvancesFutureRevision verifies timestamps remain strictly monotonic.
func TestSettingsServiceAdvancesFutureRevision(t *testing.T) {
	ctx := t.Context()
	pool := systemTestPool(t, ctx)
	seedEditableSettings(t, ctx, pool)
	future := time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond)
	if _, err := pool.Exec(ctx, `update system_setting set updated_at = $1 where key = 'site.settings_revision'`, future); err != nil {
		t.Fatal(err)
	}
	service := system.NewSettingsService(pool, permission.NewService(), &settingsPolicyStub{})
	updated, err := service.UpdateSettings(ctx, auth.CurrentUser{GroupKey: permission.GroupAdmin}, system.UpdateSettingsInput{
		SiteName: "MoeURL", DefaultLanguage: "en", DefaultTheme: "system", ShowPoweredBy: true, LocalLoginEnabled: true, ExpectedUpdatedAt: future.Format(time.RFC3339Nano),
	})
	if err != nil {
		t.Fatalf("update future revision: %v", err)
	}
	got, err := time.Parse(time.RFC3339Nano, updated.UpdatedAt)
	if err != nil || !got.Equal(future.Add(time.Microsecond)) {
		t.Fatalf("updated revision=%s error=%v", updated.UpdatedAt, err)
	}
}

// TestSettingsServiceRollsBackWhenProviderInvariantFails verifies policy failures retain their error category and persist nothing.
func TestSettingsServiceRollsBackWhenProviderInvariantFails(t *testing.T) {
	for _, test := range []struct {
		name         string
		policyErr    error
		wantBusiness bool
	}{
		{name: "no available provider", policyErr: loginpolicy.ErrNoAvailableProvider, wantBusiness: true},
		{name: "provider query failure", policyErr: errors.New("provider query failed")},
	} {
		t.Run(test.name, func(t *testing.T) {
			ctx := t.Context()
			pool := systemTestPool(t, ctx)
			seedEditableSettings(t, ctx, pool)
			policy := &settingsPolicyStub{requireErr: test.policyErr}
			service := system.NewSettingsService(pool, permission.NewService(), policy)
			admin := auth.CurrentUser{GroupKey: permission.GroupAdmin}
			current, err := service.GetSettings(ctx, admin)
			if err != nil {
				t.Fatalf("read current settings: %v", err)
			}
			input := system.UpdateSettingsInput{
				SiteName: "Changed", DefaultLanguage: "en", DefaultTheme: "light",
				ShowPoweredBy: true, LocalLoginEnabled: false, ExpectedUpdatedAt: current.UpdatedAt,
			}
			_, err = service.UpdateSettings(ctx, admin, input)
			if test.wantBusiness {
				if !errors.Is(err, system.ErrNoLoginProvider) || !errors.Is(err, test.policyErr) {
					t.Fatalf("provider invariant error = %v", err)
				}
			} else if !errors.Is(err, test.policyErr) || errors.Is(err, system.ErrNoLoginProvider) {
				t.Fatalf("provider infrastructure error = %v", err)
			}
			after, readErr := service.GetSettings(ctx, admin)
			if readErr != nil || after.SiteName != current.SiteName || after.UpdatedAt != current.UpdatedAt {
				t.Fatalf("settings changed after rollback: before=%#v after=%#v err=%v", current, after, readErr)
			}
		})
	}
}

type settingsPolicyStub struct {
	lockCalls    int
	requireCalls int
	lockErr      error
	requireErr   error
}

func (s *settingsPolicyStub) LockLocalLogin(context.Context, pgx.Tx) (bool, error) {
	s.lockCalls++
	return true, s.lockErr
}

func (s *settingsPolicyStub) RequireAvailableProvider(context.Context, pgx.Tx) error {
	s.requireCalls++
	return s.requireErr
}

func seedEditableSettings(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		insert into system_setting (key, value, created_at, updated_at) values
			('site.name', '"MoeURL"'::jsonb, now(), now()),
			('site.default_language', '"zh-CN"'::jsonb, now(), now()),
			('site.default_theme', '"system"'::jsonb, now(), now())
		on conflict (key) do nothing
	`); err != nil {
		t.Fatalf("seed editable settings: %v", err)
	}
}

func currentRevision(t *testing.T, ctx context.Context, pool *pgxpool.Pool) string {
	t.Helper()
	var updatedAt time.Time
	if err := pool.QueryRow(ctx, `select updated_at from system_setting where key = 'site.settings_revision'`).Scan(&updatedAt); err != nil {
		t.Fatal(err)
	}
	return updatedAt.UTC().Format(time.RFC3339Nano)
}

type failingPermissionResolver struct{ err error }

func (r failingPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, r.err
}
