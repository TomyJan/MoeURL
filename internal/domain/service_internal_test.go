package domain

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type failingDomainPermissionResolver struct {
	err error
}

func (r failingDomainPermissionResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, r.err
}

func internalDomainFixture(t *testing.T) (*Service, *pgxpool.Pool, auth.CurrentUser, ChangeInput) {
	t.Helper()
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	userGroupID, adminGroupID, domainID := uuid.New(), uuid.New(), uuid.New()
	if _, err := pool.Exec(ctx, `
		insert into user_group (id, key, name, permissions, builtin, created_at, updated_at)
		values ($1, 'user', 'User', '[]', true, now(), now()),
		       ($2, 'admin', 'Admin', '[]', true, now(), now())
	`, userGroupID, adminGroupID); err != nil {
		t.Fatalf("prepare internal domain groups: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain (id, host, display_name, purpose, enabled, is_default, created_at, updated_at)
		values ($1, 'go.example.com', 'Default', 'short_link', true, true, now(), now())
	`, domainID); err != nil {
		t.Fatalf("prepare internal default domain: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		insert into domain_user_group (domain_id, user_group_id) values ($1, $2), ($1, $3)
	`, domainID, userGroupID, adminGroupID); err != nil {
		t.Fatalf("prepare internal domain grants: %v", err)
	}
	var updatedAt time.Time
	if err := pool.QueryRow(ctx, `select updated_at from domain where id = $1`, domainID).Scan(&updatedAt); err != nil {
		t.Fatalf("load internal default version: %v", err)
	}
	return NewService(pool, permission.NewService()), pool,
		auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupAdmin},
		ChangeInput{ID: domainID.String(), ExpectedUpdatedAt: updatedAt.UTC().Format(time.RFC3339Nano)}
}

func installDomainTrigger(t *testing.T, pool *pgxpool.Pool, statements string) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), statements); err != nil {
		t.Fatalf("install domain failure trigger: %v", err)
	}
}

func TestServiceCoversPermissionQueryAndHelperFailures(t *testing.T) {
	actor := auth.CurrentUser{ID: uuid.NewString(), GroupKey: permission.GroupAdmin}
	if err := (&Service{}).authorizeAdmin(t.Context(), actor); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("nil resolver authorization error = %v", err)
	}
	if result, err := (&Service{}).Available(t.Context(), actor); !errors.Is(err, ErrPermissionDenied) || result.Items == nil {
		t.Fatalf("nil resolver available = %#v, %v", result, err)
	}

	resolverErr := errors.New("permission lookup failed")
	service := &Service{permissions: failingDomainPermissionResolver{err: resolverErr}}
	if err := service.authorizeAdmin(t.Context(), actor); !errors.Is(err, resolverErr) {
		t.Fatalf("resolver authorization error = %v", err)
	}
	if result, err := service.Available(t.Context(), actor); !errors.Is(err, resolverErr) || result.Items == nil {
		t.Fatalf("resolver available = %#v, %v", result, err)
	}

	service, pool, admin, _ := internalDomainFixture(t)
	canceled, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := service.List(canceled, admin); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled list error = %v", err)
	}
	if _, err := service.Available(canceled, admin); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled available error = %v", err)
	}
	if err := checkAuthorityConflict(canceled, sqlc.New(pool), "https://new.example.com", uuid.Nil); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled authority lookup error = %v", err)
	}
	if err := replaceGrants(canceled, sqlc.New(pool), pgUUID(uuid.New()), []string{permission.GroupUser}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled grant replacement error = %v", err)
	}

	plainErr := errors.New("plain database error")
	if !errors.Is(mapNotFound(pgx.ErrNoRows), ErrDomainNotFound) || !errors.Is(mapNotFound(plainErr), plainErr) {
		t.Fatal("not-found mapping did not preserve expected errors")
	}
	if !errors.Is(mapUniqueConflict(&pgconn.PgError{Code: "23505"}), ErrDomainConflict) ||
		!errors.Is(mapUniqueConflict(plainErr), plainErr) {
		t.Fatal("unique-conflict mapping did not preserve expected errors")
	}
	if err := replaceGrants(t.Context(), sqlc.New(pool), pgUUID(uuid.New()), []string{"unknown"}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("unknown grant replacement error = %v", err)
	}
}

func TestServiceCoversListAndCreateDatabaseFailures(t *testing.T) {
	t.Run("list grants", func(t *testing.T) {
		service, pool, admin, _ := internalDomainFixture(t)
		if _, err := pool.Exec(t.Context(), `drop table domain_user_group`); err != nil {
			t.Fatalf("drop grant table: %v", err)
		}
		if _, err := service.List(t.Context(), admin); err == nil {
			t.Fatal("list should fail when grant lookup is unavailable")
		}
	})

	t.Run("create unique violation", func(t *testing.T) {
		service, pool, admin, _ := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_domain_insert() returns trigger language plpgsql as $$
			begin raise unique_violation using message = 'forced unique violation'; end $$;
			create trigger fail_domain_insert before insert on domain
			for each row execute function fail_domain_insert();
		`)
		_, err := service.Create(t.Context(), admin, CreateInput{
			Host: "https://new.example.com", DisplayName: "New", AllowedGroups: []string{}, Enabled: true,
		})
		if !errors.Is(err, ErrDomainConflict) {
			t.Fatalf("create database conflict error = %v", err)
		}
	})

	t.Run("create grants", func(t *testing.T) {
		service, pool, admin, _ := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_domain_grant_insert() returns trigger language plpgsql as $$
			begin raise exception 'forced grant failure'; end $$;
			create trigger fail_domain_grant_insert before insert on domain_user_group
			for each row execute function fail_domain_grant_insert();
		`)
		_, err := service.Create(t.Context(), admin, CreateInput{
			Host: "https://new.example.com", DisplayName: "New", AllowedGroups: []string{permission.GroupUser}, Enabled: true,
		})
		if err == nil {
			t.Fatal("create should fail when grant insertion fails")
		}
	})
}

func TestServiceCoversUpdateDatabaseAndProtectionFailures(t *testing.T) {
	t.Run("protect default", func(t *testing.T) {
		service, _, admin, current := internalDomainFixture(t)
		_, err := service.Update(t.Context(), admin, UpdateInput{
			ID: current.ID, Host: "go.example.com", DisplayName: "Default",
			AllowedGroups: []string{}, Enabled: false, ExpectedUpdatedAt: current.ExpectedUpdatedAt,
		})
		if !errors.Is(err, ErrDomainProtected) {
			t.Fatalf("disable default error = %v", err)
		}
	})

	t.Run("reference query", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		if _, err := pool.Exec(t.Context(), `drop table short_link cascade`); err != nil {
			t.Fatalf("drop short-link table: %v", err)
		}
		_, err := service.Update(t.Context(), admin, UpdateInput{
			ID: current.ID, Host: "go.example.com", DisplayName: "Default",
			AllowedGroups: []string{}, Enabled: true, ExpectedUpdatedAt: current.ExpectedUpdatedAt,
		})
		if err == nil {
			t.Fatal("update should fail when reference lookup is unavailable")
		}
	})

	t.Run("update row", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_domain_update() returns trigger language plpgsql as $$
			begin raise unique_violation using message = 'forced update failure'; end $$;
			create trigger fail_domain_update before update on domain
			for each row execute function fail_domain_update();
		`)
		_, err := service.Update(t.Context(), admin, UpdateInput{
			ID: current.ID, Host: "go.example.com", DisplayName: "Changed",
			AllowedGroups: []string{}, Enabled: true, ExpectedUpdatedAt: current.ExpectedUpdatedAt,
		})
		if !errors.Is(err, ErrDomainConflict) {
			t.Fatalf("update database conflict error = %v", err)
		}
	})

	t.Run("replace grants", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_domain_grant_insert() returns trigger language plpgsql as $$
			begin raise exception 'forced grant failure'; end $$;
			create trigger fail_domain_grant_insert before insert on domain_user_group
			for each row execute function fail_domain_grant_insert();
		`)
		_, err := service.Update(t.Context(), admin, UpdateInput{
			ID: current.ID, Host: "go.example.com", DisplayName: "Changed",
			AllowedGroups: []string{permission.GroupUser}, Enabled: true, ExpectedUpdatedAt: current.ExpectedUpdatedAt,
		})
		if err == nil {
			t.Fatal("update should fail when grant insertion fails")
		}
	})

	t.Run("default setting", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_system_setting_write() returns trigger language plpgsql as $$
			begin raise exception 'forced setting failure'; end $$;
			create trigger fail_system_setting_write before insert or update on system_setting
			for each row execute function fail_system_setting_write();
		`)
		_, err := service.Update(t.Context(), admin, UpdateInput{
			ID: current.ID, Host: "go.example.com", DisplayName: "Changed",
			AllowedGroups: []string{}, Enabled: true, ExpectedUpdatedAt: current.ExpectedUpdatedAt,
		})
		if err == nil {
			t.Fatal("default update should fail when setting synchronization fails")
		}
	})
}

func TestServiceCoversSetDefaultDatabaseFailures(t *testing.T) {
	t.Run("clear current default", func(t *testing.T) {
		service, pool, admin, _ := internalDomainFixture(t)
		next, err := service.Create(t.Context(), admin, CreateInput{
			Host: "https://next.example.com", DisplayName: "Next", AllowedGroups: []string{}, Enabled: true,
		})
		if err != nil {
			t.Fatalf("create next default: %v", err)
		}
		installDomainTrigger(t, pool, `
			create function fail_default_clear() returns trigger language plpgsql as $$
			begin
				if old.is_default and not new.is_default then raise exception 'forced clear failure'; end if;
				return new;
			end $$;
			create trigger fail_default_clear before update on domain
			for each row execute function fail_default_clear();
		`)
		if _, err := service.SetDefault(t.Context(), admin, ChangeInput{ID: next.ID, ExpectedUpdatedAt: next.UpdatedAt}); err == nil {
			t.Fatal("set default should fail when clearing the current default fails")
		}
	})

	t.Run("make default", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_default_update() returns trigger language plpgsql as $$
			begin raise exception 'forced make-default failure'; end $$;
			create trigger fail_default_update before update on domain
			for each row execute function fail_default_update();
		`)
		if _, err := service.SetDefault(t.Context(), admin, current); err == nil {
			t.Fatal("set default should fail when the domain update fails")
		}
	})

	t.Run("setting mirror", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		installDomainTrigger(t, pool, `
			create function fail_system_setting_write() returns trigger language plpgsql as $$
			begin raise exception 'forced setting failure'; end $$;
			create trigger fail_system_setting_write before insert or update on system_setting
			for each row execute function fail_system_setting_write();
		`)
		if _, err := service.SetDefault(t.Context(), admin, current); err == nil {
			t.Fatal("set default should fail when setting synchronization fails")
		}
	})

	t.Run("grant lookup", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		if _, err := pool.Exec(t.Context(), `drop table domain_user_group`); err != nil {
			t.Fatalf("drop grant table: %v", err)
		}
		if _, err := service.SetDefault(t.Context(), admin, current); err == nil {
			t.Fatal("set default should fail when grant lookup is unavailable")
		}
	})

	t.Run("reference lookup", func(t *testing.T) {
		service, pool, admin, current := internalDomainFixture(t)
		if _, err := pool.Exec(t.Context(), `drop table short_link cascade`); err != nil {
			t.Fatalf("drop short-link table: %v", err)
		}
		if _, err := service.SetDefault(t.Context(), admin, current); err == nil {
			t.Fatal("set default should fail when reference lookup is unavailable")
		}
	})
}

func TestServiceCoversDeleteDatabaseFailures(t *testing.T) {
	createCandidate := func(t *testing.T) (*Service, *pgxpool.Pool, auth.CurrentUser, ChangeInput) {
		t.Helper()
		service, pool, admin, _ := internalDomainFixture(t)
		created, err := service.Create(t.Context(), admin, CreateInput{
			Host: "https://delete.example.com", DisplayName: "Delete", AllowedGroups: []string{}, Enabled: true,
		})
		if err != nil {
			t.Fatalf("create delete candidate: %v", err)
		}
		return service, pool, admin, ChangeInput{ID: created.ID, ExpectedUpdatedAt: created.UpdatedAt}
	}

	t.Run("reference query", func(t *testing.T) {
		service, pool, admin, candidate := createCandidate(t)
		if _, err := pool.Exec(t.Context(), `drop table short_link cascade`); err != nil {
			t.Fatalf("drop short-link table: %v", err)
		}
		if err := service.Delete(t.Context(), admin, candidate); err == nil {
			t.Fatal("delete should fail when reference lookup is unavailable")
		}
	})

	t.Run("delete row", func(t *testing.T) {
		service, pool, admin, candidate := createCandidate(t)
		installDomainTrigger(t, pool, `
			create function fail_domain_delete() returns trigger language plpgsql as $$
			begin raise exception 'forced delete failure'; end $$;
			create trigger fail_domain_delete before delete on domain
			for each row execute function fail_domain_delete();
		`)
		if err := service.Delete(t.Context(), admin, candidate); err == nil {
			t.Fatal("delete should fail when the database rejects deletion")
		}
	})

	t.Run("zero affected rows", func(t *testing.T) {
		service, pool, admin, candidate := createCandidate(t)
		installDomainTrigger(t, pool, `
			create function skip_domain_delete() returns trigger language plpgsql as $$
			begin return null; end $$;
			create trigger skip_domain_delete before delete on domain
			for each row execute function skip_domain_delete();
		`)
		if err := service.Delete(t.Context(), admin, candidate); !errors.Is(err, ErrVersionConflict) {
			t.Fatalf("skipped delete error = %v", err)
		}
	})
}
