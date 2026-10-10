package loginpolicy_test

import (
	"context"
	"errors"
	"testing"
	"time"

	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/loginpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// TestServiceReadsAndLocksLocalLogin verifies the shared setting is parsed and locked transactionally.
func TestServiceReadsAndLocksLocalLogin(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })

	enabled, err := service.LocalLoginEnabled(ctx)
	if err != nil || !enabled {
		t.Fatalf("default local login = %t, error = %v", enabled, err)
	}
	if _, err := pool.Exec(ctx, `update system_setting set value = 'false'::jsonb where key = 'auth.local_login_enabled'`); err != nil {
		t.Fatalf("disable local login: %v", err)
	}

	err = appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
		locked, err := service.LockLocalLogin(ctx, tx)
		if err != nil || locked {
			t.Fatalf("locked local login = %t, error = %v", locked, err)
		}
		blockedCtx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
		defer cancel()
		_, updateErr := pool.Exec(blockedCtx, `update system_setting set value = 'true'::jsonb where key = 'auth.local_login_enabled'`)
		if !errors.Is(updateErr, context.DeadlineExceeded) {
			t.Fatalf("concurrent update error = %v, want deadline exceeded", updateErr)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("lock local login transaction: %v", err)
	}
}

// TestServiceReadsLoginMethodsSnapshot verifies the public login policy and providers share one database snapshot.
func TestServiceReadsLoginMethodsSnapshot(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	insertEnabledProvider(t, ctx, pool)
	service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })

	enabled, providers, err := service.LoginMethodsSnapshot(ctx)
	if err != nil {
		t.Fatalf("read login methods snapshot: %v", err)
	}
	if !enabled || len(providers) != 1 || providers[0].Key != "company" {
		t.Fatalf("login methods snapshot enabled=%t providers=%#v", enabled, providers)
	}
}

// TestServiceRequiresAvailableProvider verifies disabled local login has one valid persisted OIDC entry point.
func TestServiceRequiresAvailableProvider(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	validated := 0
	service := loginpolicy.NewService(pool, func(rows []sqlc.OidcProvider) error {
		validated = len(rows)
		return nil
	})

	err := appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
		return service.RequireAvailableProvider(ctx, tx)
	})
	if !errors.Is(err, loginpolicy.ErrNoAvailableProvider) {
		t.Fatalf("empty provider error = %v", err)
	}
	insertEnabledProvider(t, ctx, pool)
	if err := appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
		return service.RequireAvailableProvider(ctx, tx)
	}); err != nil {
		t.Fatalf("validate available provider: %v", err)
	}
	if validated != 1 {
		t.Fatalf("validated provider count = %d, want 1", validated)
	}
}

// TestServiceValidateStartupEnforcesEntryPointInvariant verifies startup only requires OIDC when local login is disabled.
func TestServiceValidateStartupEnforcesEntryPointInvariant(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	validationErr := errors.New("invalid provider runtime")
	service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return validationErr })

	if err := service.ValidateStartup(ctx); err != nil {
		t.Fatalf("enabled local login startup: %v", err)
	}
	if _, err := pool.Exec(ctx, `update system_setting set value = 'false'::jsonb where key = 'auth.local_login_enabled'`); err != nil {
		t.Fatalf("disable local login: %v", err)
	}
	if err := service.ValidateStartup(ctx); !errors.Is(err, loginpolicy.ErrNoAvailableProvider) {
		t.Fatalf("startup without provider error = %v", err)
	}
	insertEnabledProvider(t, ctx, pool)
	if err := service.ValidateStartup(ctx); !errors.Is(err, loginpolicy.ErrNoAvailableProvider) || !errors.Is(err, validationErr) {
		t.Fatalf("invalid provider startup error = %v", err)
	}
}

// TestServiceValidateStartupUsesOneSnapshot verifies concurrent policy changes cannot create a torn startup decision.
func TestServiceValidateStartupUsesOneSnapshot(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	if _, err := pool.Exec(ctx, `update system_setting set value = 'false'::jsonb where key = 'auth.local_login_enabled'`); err != nil {
		t.Fatalf("disable local login: %v", err)
	}
	insertEnabledProvider(t, ctx, pool)

	locker, err := pool.Begin(ctx)
	if err != nil {
		t.Fatalf("begin provider lock: %v", err)
	}
	defer func() { _ = locker.Rollback(ctx) }()
	if _, err := locker.Exec(ctx, `lock table oidc_provider in access exclusive mode`); err != nil {
		t.Fatalf("lock provider table: %v", err)
	}

	validatedProviders := 0
	service := loginpolicy.NewService(pool, func(rows []sqlc.OidcProvider) error {
		validatedProviders = len(rows)
		return nil
	})
	result := make(chan error, 1)
	go func() { result <- service.ValidateStartup(ctx) }()

	deadline := time.Now().Add(5 * time.Second)
	for {
		var waiting int
		if err := pool.QueryRow(ctx, `
			select count(*)
			from pg_locks
			where relation = 'oidc_provider'::regclass
				and mode = 'AccessShareLock'
				and not granted
		`).Scan(&waiting); err != nil {
			t.Fatalf("inspect blocked startup query: %v", err)
		}
		if waiting > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("startup validation did not reach the provider query")
		}
		time.Sleep(10 * time.Millisecond)
	}

	if _, err := locker.Exec(ctx, `
		update system_setting set value = 'true'::jsonb where key = 'auth.local_login_enabled';
		delete from oidc_provider;
	`); err != nil {
		t.Fatalf("switch login entry while startup is blocked: %v", err)
	}
	if err := locker.Commit(ctx); err != nil {
		t.Fatalf("commit login-entry switch: %v", err)
	}

	if err := <-result; err != nil {
		t.Fatalf("validate consistent startup snapshot: %v", err)
	}
	if validatedProviders != 1 {
		t.Fatalf("validated provider count = %d, want 1 from the startup snapshot", validatedProviders)
	}
}

// TestServiceRejectsCorruptPolicyValue verifies malformed persisted settings fail closed.
func TestServiceRejectsCorruptPolicyValue(t *testing.T) {
	for _, value := range []string{`'"invalid"'::jsonb`, `'null'::jsonb`} {
		t.Run(value, func(t *testing.T) {
			ctx := t.Context()
			pool := testdb.ProjectMigratedPool(ctx, t)
			if _, err := pool.Exec(ctx, `update system_setting set value = `+value+` where key = 'auth.local_login_enabled'`); err != nil {
				t.Fatalf("corrupt local-login setting: %v", err)
			}
			service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })
			if _, err := service.LocalLoginEnabled(ctx); !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
				t.Fatalf("corrupt policy error = %v", err)
			}
			if _, _, err := service.LoginMethodsSnapshot(ctx); !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
				t.Fatalf("corrupt methods snapshot error = %v", err)
			}
			if err := service.ValidateStartup(ctx); !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
				t.Fatalf("corrupt startup policy error = %v", err)
			}
		})
	}
}

// TestServiceHandlesMissingRowsAndDatabaseFailures verifies missing policy and storage failures fail closed.
func TestServiceHandlesMissingRowsAndDatabaseFailures(t *testing.T) {
	t.Run("missing policy is invalid", func(t *testing.T) {
		ctx := t.Context()
		pool := testdb.ProjectMigratedPool(ctx, t)
		if _, err := pool.Exec(ctx, `delete from system_setting where key = 'auth.local_login_enabled'`); err != nil {
			t.Fatalf("delete local-login setting: %v", err)
		}
		service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })
		if enabled, err := service.LocalLoginEnabled(ctx); enabled || !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
			t.Fatalf("missing local-login setting = %t, error = %v", enabled, err)
		}
		if snapshotEnabled, providers, err := service.LoginMethodsSnapshot(ctx); snapshotEnabled || providers != nil || !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
			t.Fatalf("missing snapshot setting enabled=%t providers=%#v error=%v", snapshotEnabled, providers, err)
		}
		if err := service.ValidateStartup(ctx); !errors.Is(err, loginpolicy.ErrInvalidPolicy) {
			t.Fatalf("missing startup policy error = %v", err)
		}
		if err := appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
			_, err := service.LockLocalLogin(ctx, tx)
			return err
		}); err == nil {
			t.Fatal("expected missing locked policy row to fail")
		}
	})

	t.Run("policy query failure", func(t *testing.T) {
		ctx := t.Context()
		pool := testdb.ProjectMigratedPool(ctx, t)
		service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })
		if _, err := pool.Exec(ctx, `drop table system_setting`); err != nil {
			t.Fatalf("drop system settings: %v", err)
		}
		if _, err := service.LocalLoginEnabled(ctx); err == nil {
			t.Fatal("expected policy query failure")
		}
		if _, _, err := service.LoginMethodsSnapshot(ctx); err == nil {
			t.Fatal("expected methods snapshot query failure")
		}
		if err := service.ValidateStartup(ctx); err == nil {
			t.Fatal("expected startup policy query failure")
		}
	})

	t.Run("provider query failure", func(t *testing.T) {
		ctx := t.Context()
		pool := testdb.ProjectMigratedPool(ctx, t)
		service := loginpolicy.NewService(pool, func([]sqlc.OidcProvider) error { return nil })
		if _, err := pool.Exec(ctx, `update system_setting set value = 'false'::jsonb where key = 'auth.local_login_enabled'; drop table oidc_provider cascade`); err != nil {
			t.Fatalf("break provider storage: %v", err)
		}
		if err := service.ValidateStartup(ctx); err == nil {
			t.Fatal("expected startup provider query failure")
		}
		if _, _, err := service.LoginMethodsSnapshot(ctx); err == nil {
			t.Fatal("expected methods snapshot provider query failure")
		}
		if err := appdb.WithTx(ctx, pool, func(tx pgx.Tx) error {
			return service.RequireAvailableProvider(ctx, tx)
		}); err == nil {
			t.Fatal("expected transactional provider query failure")
		}
	})
}

func insertEnabledProvider(t *testing.T, ctx context.Context, pool interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}) {
	t.Helper()
	if _, err := pool.Exec(ctx, `
		insert into oidc_provider (
			id, key, display_name, issuer_url, client_id, client_secret_ciphertext,
			authorization_endpoint, token_endpoint, jwks_uri, allowed_email_domains,
			enabled, created_at, updated_at
		) values (
			'00000000-0000-0000-0000-000000000901', 'company', 'Company SSO',
			'https://id.example.com', 'client', decode('01', 'hex'),
			'https://id.example.com/authorize', 'https://id.example.com/token',
			'https://id.example.com/jwks', '["example.com"]'::jsonb, true, now(), now()
		)
	`); err != nil {
		t.Fatalf("insert enabled provider: %v", err)
	}
}
