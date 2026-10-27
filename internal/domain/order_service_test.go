package domain_test

import (
	"context"
	"errors"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/domain"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// orderFixture adds persisted actors: SetOrder intentionally ignores session group snapshots.
func orderFixture(t *testing.T) (*domain.Service, *pgxpool.Pool, auth.CurrentUser, auth.CurrentUser, domain.Domain) {
	t.Helper()
	_, pool, admin, user := domainFixture(t)
	_, err := pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		select $1,'order-user','User',id,'active',false,now(),now() from user_group where key='user'`, user.ID)
	require.NoError(t, err)
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions || '["short_link:create"]'::jsonb where key='user'`)
	require.NoError(t, err)
	s := domain.NewService(pool, permission.NewDatabaseService(pool))
	created, err := s.Create(t.Context(), admin, domain.CreateInput{Host: "https://ordered.example.com", DisplayName: "Ordered", Enabled: true, AllowedGroups: []string{"user", "admin"}})
	require.NoError(t, err)
	return s, pool, admin, user, created
}

func orderInput(d domain.Domain, order int32) domain.SetOrderInput {
	return domain.SetOrderInput{ID: d.ID, SortOrder: order, ExpectedUpdatedAt: d.UpdatedAt}
}

// Catches default precedence, unauthorized/disabled choices, unstable ties and legacy saves clearing order.
func TestDomainOrderStableAuthorizedLists(t *testing.T) {
	s, pool, admin, user, d := orderFixture(t)
	ctx := t.Context()
	_, err := pool.Exec(ctx, `update domain set sort_order=10000 where is_default`)
	require.NoError(t, err)
	const early = "00000000-0000-0000-0000-000000002701"
	const late = "00000000-0000-0000-0000-000000002702"
	const hidden = "00000000-0000-0000-0000-000000002703"
	const disabled = "00000000-0000-0000-0000-000000002704"
	_, err = pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,sort_order,created_at,updated_at) values
		($1,'https://early.example.com','Early','short_link',true,false,-20,'2021-01-01Z',now()),
		($2,'https://late.example.com','Late','short_link',true,false,-20,'2021-01-01Z',now()),
		($3,'https://hidden.example.com','Hidden','short_link',true,false,-10000,'2021-01-01Z',now()),
		($4,'https://disabled.example.com','Disabled','short_link',false,false,-10000,'2021-01-01Z',now())`, early, late, hidden, disabled)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) select d.id,g.id from domain d cross join user_group g where d.id=any($1::uuid[]) and g.key='user'`, []string{early, late, disabled})
	require.NoError(t, err)
	available, err := s.Available(ctx, user)
	require.NoError(t, err)
	var defaultID string
	require.NoError(t, pool.QueryRow(ctx, `select id::text from domain where is_default`).Scan(&defaultID))
	ids := make([]string, 0, len(available.Items))
	for _, item := range available.Items {
		ids = append(ids, item.ID)
	}
	require.Equal(t, []string{defaultID, early, late, d.ID}, ids)
	managed, err := s.List(ctx, admin)
	require.NoError(t, err)
	ids = ids[:0]
	for _, item := range managed.Items {
		ids = append(ids, item.ID)
	}
	require.Equal(t, []string{defaultID, hidden, disabled, early, late, d.ID}, ids)
	sorted, err := s.SetOrder(ctx, admin, orderInput(d, -5))
	require.NoError(t, err)
	require.Equal(t, int32(-5), sorted.SortOrder)
	updated, err := s.Update(ctx, admin, domain.UpdateInput{ID: d.ID, Host: d.Host, DisplayName: "Renamed", Enabled: false, AllowedGroups: []string{"admin"}, ExpectedUpdatedAt: sorted.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, int32(-5), updated.SortOrder)
	require.Equal(t, []string{"admin"}, updated.AllowedGroups)
	// Disabled domains can still be organized without changing their status or grants.
	reordered, err := s.SetOrder(ctx, admin, orderInput(updated, -6))
	require.NoError(t, err)
	require.False(t, reordered.Enabled)
	require.Equal(t, "Renamed", reordered.DisplayName)
	require.Equal(t, []string{"admin"}, reordered.AllowedGroups)
}

// Catches no-op audit/version noise, lost updates and checking value before revision.
func TestDomainOrderNoopAndConcurrentLegacyUpdate(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	ctx := t.Context()
	var before, after int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&before))
	unchanged, err := s.SetOrder(ctx, admin, orderInput(d, 0))
	require.NoError(t, err)
	require.Equal(t, d.UpdatedAt, unchanged.UpdatedAt)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&after))
	require.Equal(t, before, after)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for _, value := range []int32{-10, 10} {
		wg.Go(func() { <-start; _, err := s.SetOrder(ctx, admin, orderInput(d, value)); results <- err })
	}
	close(start)
	wg.Wait()
	close(results)
	success, conflicts := 0, 0
	for err := range results {
		if err == nil {
			success++
		} else {
			require.ErrorIs(t, err, domain.ErrVersionConflict)
			conflicts++
		}
	}
	require.Equal(t, 1, success)
	require.Equal(t, 1, conflicts)
	var value int32
	require.NoError(t, pool.QueryRow(ctx, `select sort_order from domain where id=$1`, d.ID).Scan(&value))
	_, err = s.SetOrder(ctx, admin, orderInput(d, value))
	require.ErrorIs(t, err, domain.ErrVersionConflict)
	_, err = s.Update(ctx, admin, domain.UpdateInput{ID: d.ID, Host: d.Host, DisplayName: "Stale", Enabled: true, AllowedGroups: []string{"admin"}, ExpectedUpdatedAt: d.UpdatedAt})
	require.ErrorIs(t, err, domain.ErrVersionConflict)
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&after))
	require.Equal(t, before+1, after)
}

// Gate the first writer on the domain row, then observe the second waiting on the
// shared advisory protocol. Both orderings must serialize against legacy actions.
func TestDomainOrderSerializesLegacyActions(t *testing.T) {
	for _, action := range []string{"update", "delete", "default"} {
		for _, orderFirst := range []bool{true, false} {
			t.Run(action+map[bool]string{true: "/order_first", false: "/legacy_first"}[orderFirst], func(t *testing.T) {
				s, pool, admin, _, d := orderFixture(t)
				ctx := t.Context()
				gate, err := pool.Begin(ctx)
				require.NoError(t, err)
				defer func() { _ = gate.Rollback(context.Background()) }()
				_, err = gate.Exec(ctx, `select id from domain where id=$1 for update`, d.ID)
				require.NoError(t, err)
				order := func() error { _, err := s.SetOrder(ctx, admin, orderInput(d, -7)); return err }
				legacy := func() error {
					switch action {
					case "delete":
						return s.Delete(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
					case "default":
						_, err := s.SetDefault(ctx, admin, domain.ChangeInput{ID: d.ID, ExpectedUpdatedAt: d.UpdatedAt})
						return err
					default:
						_, err := s.Update(ctx, admin, domain.UpdateInput{ID: d.ID, Host: d.Host, DisplayName: "Edited", Enabled: true, AllowedGroups: []string{"user", "admin"}, ExpectedUpdatedAt: d.UpdatedAt})
						return err
					}
				}
				first, second := order, legacy
				if !orderFirst {
					first, second = legacy, order
				}
				one, two := make(chan error, 1), make(chan error, 1)
				go func() { one <- first() }()
				waitForDomainLockWaiters(t, pool, 1)
				go func() { two <- second() }()
				waitForDomainLockWaiters(t, pool, 2)
				require.NoError(t, gate.Commit(ctx))
				require.NoError(t, <-one)
				secondErr := <-two
				if action == "delete" && !orderFirst {
					require.ErrorIs(t, secondErr, domain.ErrDomainNotFound)
				} else {
					require.ErrorIs(t, secondErr, domain.ErrVersionConflict)
				}
				if action == "delete" && !orderFirst {
					var count int
					require.NoError(t, pool.QueryRow(ctx, `select count(*) from domain where id=$1`, d.ID).Scan(&count))
					require.Zero(t, count)
					return
				}
				var sort int32
				var name string
				var isDefault bool
				require.NoError(t, pool.QueryRow(ctx, `select sort_order,display_name,is_default from domain where id=$1`, d.ID).Scan(&sort, &name, &isDefault))
				if orderFirst {
					require.Equal(t, int32(-7), sort)
					require.Equal(t, "Ordered", name)
					require.False(t, isDefault)
				} else {
					require.Zero(t, sort)
					require.Equal(t, action == "default", isDefault)
				}
			})
		}
	}
}

// Catches authorization based on stale session data, or checks performed before
// the domain advisory lock instead of after the blocked request resumes.
func TestDomainOrderReauthorizesAfterDomainLock(t *testing.T) {
	for _, mutation := range []struct{ name, sql string }{
		{"disabled", `update app_user set status='disabled' where id=$1`},
		{"deleted", `update app_user set deleted_at=now() where id=$1`},
		{"moved", `update app_user set group_id=(select id from user_group where key='user') where id=$1`},
		{"manage revoked", `update user_group set permissions='["admin:access"]' where id=(select group_id from app_user where id=$1)`},
		{"access revoked", `update user_group set permissions='["domain:manage"]' where id=(select group_id from app_user where id=$1)`},
		{"not builtin", `update user_group set builtin=false where id=(select group_id from app_user where id=$1)`},
	} {
		t.Run(mutation.name, func(t *testing.T) {
			s, pool, admin, _, d := orderFixture(t)
			ctx := t.Context()
			gate, err := pool.Begin(ctx)
			require.NoError(t, err)
			defer func() { _ = gate.Rollback(context.Background()) }()
			_, err = gate.Exec(ctx, `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
			require.NoError(t, err)
			result := make(chan error, 1)
			go func() { _, err := s.SetOrder(ctx, admin, orderInput(d, -12)); result <- err }()
			waitForDomainLockWaiters(t, pool, 1)
			_, err = pool.Exec(ctx, mutation.sql, admin.ID)
			require.NoError(t, err)
			require.NoError(t, gate.Commit(ctx))
			require.ErrorIs(t, <-result, domain.ErrPermissionDenied)
			var sort int32
			var version time.Time
			require.NoError(t, pool.QueryRow(ctx, `select sort_order,updated_at from domain where id=$1`, d.ID).Scan(&sort, &version))
			require.Zero(t, sort)
			require.Equal(t, d.UpdatedAt, version.UTC().Format(time.RFC3339Nano))
		})
	}
}

// Catches permissions taken from the supplied GroupKey rather than current DB identity.
func TestDomainOrderUsesCurrentIdentity(t *testing.T) {
	s, pool, admin, user, d := orderFixture(t)
	admin.GroupKey = permission.GroupGuest
	changed, err := s.SetOrder(t.Context(), admin, orderInput(d, -8))
	require.NoError(t, err)
	user.GroupKey = permission.GroupAdmin
	_, err = s.SetOrder(t.Context(), user, orderInput(changed, -9))
	require.ErrorIs(t, err, domain.ErrPermissionDenied)
	for _, id := range []string{"", uuid.Nil.String(), "broken", uuid.NewString()} {
		_, err = s.SetOrder(t.Context(), auth.CurrentUser{ID: id, GroupKey: permission.GroupAdmin}, orderInput(changed, 7))
		require.ErrorIs(t, err, domain.ErrPermissionDenied)
	}
	// A malformed database permission payload must remain an infrastructure error.
	_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where key='admin'`)
	require.NoError(t, err)
	_, err = s.SetOrder(t.Context(), admin, orderInput(changed, 9))
	require.Error(t, err)
	require.False(t, errors.Is(err, domain.ErrPermissionDenied))
}

// Catches canceled lock waits falling through to an authorized write.
func TestDomainOrderCanceledLockWait(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	gate, err := pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = gate.Rollback(context.Background()) }()
	_, err = gate.Exec(t.Context(), `select pg_advisory_xact_lock($1)`, int64(0x6d6f6575726c444d))
	require.NoError(t, err)
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	result := make(chan error, 1)
	go func() { _, err := s.SetOrder(ctx, admin, orderInput(d, 4)); result <- err }()
	waitForDomainLockWaiters(t, pool, 1)
	cancel()
	require.ErrorIs(t, <-result, context.Canceled)
	var sort int32
	var version time.Time
	require.NoError(t, pool.QueryRow(t.Context(), `select sort_order,updated_at from domain where id=$1`, d.ID).Scan(&sort, &version))
	require.Zero(t, sort)
	require.Equal(t, d.UpdatedAt, version.UTC().Format(time.RFC3339Nano))
}

// Catches recording values/extra fields, non-atomic audit writes, and metadata loss.
// Migration Down/re-Up is exercised separately by TestDomainOrderMigrationRoundTrip.
func TestDomainOrderAuditRollbackAndMigrationDown(t *testing.T) {
	s, pool, admin, _, d := orderFixture(t)
	ctx := t.Context()
	changed, err := s.SetOrder(ctx, admin, orderInput(d, -10000))
	require.NoError(t, err)
	var fields []string
	var actor, resource, action string
	require.NoError(t, pool.QueryRow(ctx, `select changed_fields,actor_id::text,resource_type,action from audit_log where resource_id=$1 and action='update' order by id desc limit 1`, d.ID).Scan(&fields, &actor, &resource, &action))
	require.Equal(t, []string{"sort_order"}, fields)
	require.Equal(t, admin.ID, actor)
	require.Equal(t, "domain", resource)
	require.Equal(t, "update", action)
	var countBefore, countAfter int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&countBefore))
	_, err = pool.Exec(ctx, `create function reject_order_audit() returns trigger language plpgsql as $$ begin raise exception 'controlled audit failure'; end $$; create trigger reject_order_audit before insert on audit_log for each row execute function reject_order_audit()`)
	require.NoError(t, err)
	_, err = s.SetOrder(ctx, admin, orderInput(changed, 10000))
	require.ErrorContains(t, err, "controlled audit failure")
	var sort int32
	var version time.Time
	require.NoError(t, pool.QueryRow(ctx, `select sort_order,updated_at from domain where id=$1`, d.ID).Scan(&sort, &version))
	require.Equal(t, int32(-10000), sort)
	require.Equal(t, changed.UpdatedAt, version.UTC().Format(time.RFC3339Nano))
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from audit_log`).Scan(&countAfter))
	require.Equal(t, countBefore, countAfter)
	_, err = pool.Exec(ctx, `drop trigger reject_order_audit on audit_log`)
	require.NoError(t, err)
	maxed, err := s.SetOrder(ctx, admin, orderInput(changed, 10000))
	require.NoError(t, err)
	require.Equal(t, int32(10000), maxed.SortOrder)
	// Setting the default keeps the order; sorting a default is allowed as well.
	selected, err := s.SetDefault(ctx, admin, domain.ChangeInput{ID: maxed.ID, ExpectedUpdatedAt: maxed.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, int32(10000), selected.SortOrder)
	selected, err = s.SetOrder(ctx, admin, orderInput(selected, 3))
	require.NoError(t, err)
	require.True(t, selected.IsDefault)
	list, err := s.List(ctx, admin)
	require.NoError(t, err)
	require.Equal(t, selected.ID, list.Items[0].ID)
	require.True(t, slices.Contains(selected.AllowedGroups, "user"))
}
