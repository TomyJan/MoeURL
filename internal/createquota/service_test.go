package createquota_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/createquota"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/TomyJan/MoeURL/internal/system"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func TestMain(m *testing.M) { os.Exit(testdb.RunTests(m)) }

func fixture(t *testing.T) (*pgxpool.Pool, *createquota.Service, *shortlink.Service, auth.CurrentUser) {
	t.Helper()
	pool := testdb.ProjectMigratedPool(t.Context(), t)
	policy, err := system.NewSetupPolicy(false, "")
	require.NoError(t, err)
	require.NoError(t, system.NewService(pool, policy).Setup(t.Context(), system.SetupInput{AdminUsername: "admin", AdminPassword: "secure-password", AdminNickname: "Admin", SiteName: "MoeURL", SystemDomain: "example.com", ShortLinkDomain: "https://go.example.com", DefaultLanguage: "zh-CN", DefaultTheme: "system"}))
	var id string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&id))
	return pool, createquota.NewService(pool), shortlink.NewService(pool, permission.NewDatabaseService(pool)), auth.CurrentUser{ID: id, GroupKey: "admin"}
}
func setLimit(t *testing.T, pool *pgxpool.Pool, limit string) {
	t.Helper()
	_, err := pool.Exec(t.Context(), `update system_setting set value=jsonb_build_object('dailyLimit',$1::jsonb) where key='security.account_daily_create_quota'`, limit)
	require.NoError(t, err)
}
func usage(t *testing.T, pool *pgxpool.Pool, id string) int64 {
	t.Helper()
	var used int64
	require.NoError(t, pool.QueryRow(t.Context(), `select coalesce((select used from account_daily_create_usage where actor_id=$1),0)`, id).Scan(&used))
	return used
}
func state(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var value string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('links',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from short_link l),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_log a),'receipt',(select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,request_id),'[]') from short_link_create_batch r),'usage',(select coalesce(jsonb_agg(to_jsonb(u) order by actor_id),'[]') from account_daily_create_usage u))::text`).Scan(&value))
	return value
}
func waitBlocked(t *testing.T, pool *pgxpool.Pool, pid uint32) {
	t.Helper()
	require.Eventually(t, func() bool {
		var blocked bool
		err := pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and $1::integer=any(pg_blocking_pids(pid)))`, pid).Scan(&blocked)
		return err == nil && blocked
	}, 3*time.Second, 5*time.Millisecond, "observe an actual PostgreSQL waiter")
}
func secondActor(t *testing.T, pool *pgxpool.Pool, first auth.CurrentUser) auth.CurrentUser {
	t.Helper()
	id := uuid.NewString()
	_, err := pool.Exec(t.Context(), `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at) select $1,'second','hash','Second',group_id,'active',false,now(),now() from app_user where id=$2`, id, first.ID)
	require.NoError(t, err)
	return auth.CurrentUser{ID: id, Username: "second", GroupKey: "admin"}
}

// TestDailyCreateQuotaTransactions catches unlimited usage not being recorded,
// refunds through edits/transfer/delete/membership, and partial failed writes.
func TestDailyCreateQuotaTransactions(t *testing.T) {
	t.Run("unlimited then lower disable and reenable", func(t *testing.T) {
		pool, _, links, actor := fixture(t)
		_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/one"})
		require.NoError(t, err)
		require.Equal(t, int64(1), usage(t, pool, actor.ID))
		setLimit(t, pool, "1")
		before := state(t, pool)
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/two"})
		require.ErrorIs(t, err, createquota.ErrExhausted)
		require.Equal(t, before, state(t, pool))
		setLimit(t, pool, "null")
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/two"})
		require.NoError(t, err)
		require.Equal(t, int64(2), usage(t, pool, actor.ID))
		setLimit(t, pool, "1")
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/three"})
		require.ErrorIs(t, err, createquota.ErrExhausted)
		require.Equal(t, int64(2), usage(t, pool, actor.ID))
	})
	t.Run("edit transfer delete and group do not refund", func(t *testing.T) {
		pool, _, links, actor := fixture(t)
		recipient := secondActor(t, pool, actor)
		setLimit(t, pool, "1")
		created, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/original"})
		require.NoError(t, err)
		setLimit(t, pool, "0")
		for _, admin := range []bool{false, true} {
			target := fmt.Sprintf("https://quota.example/edited-%t", admin)
			update := links.Update
			if admin {
				update = links.AdminUpdate
			}
			_, err := update(t.Context(), actor, shortlink.UpdateInput{ID: created.ShortLink.ID, TargetURL: &target})
			require.NoError(t, err)
			require.Equal(t, int64(1), usage(t, pool, actor.ID))
		}
		var revision time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, created.ShortLink.ID).Scan(&revision))
		_, err = links.BatchTransfer(t.Context(), actor, shortlink.BatchTransferInput{NewOwnerUsername: "second", Items: []shortlink.BatchTransferItem{{ID: created.ShortLink.ID, ExpectedUpdatedAt: revision.UTC().Format(time.RFC3339Nano)}}})
		require.NoError(t, err)
		_, err = links.AdminBatch(t.Context(), actor, shortlink.BatchInput{IDs: []string{created.ShortLink.ID}, Action: "delete"})
		require.NoError(t, err)
		setLimit(t, pool, "1")
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/again"})
		require.ErrorIs(t, err, createquota.ErrExhausted)
		_, err = links.Create(t.Context(), recipient, shortlink.CreateInput{TargetURL: "https://quota.example/recipient"})
		require.NoError(t, err)
		require.Equal(t, int64(1), usage(t, pool, recipient.ID))
		_, err = pool.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='user') where id=$1`, actor.ID)
		require.NoError(t, err)
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/new-group"})
		require.ErrorIs(t, err, createquota.ErrExhausted)
		require.Equal(t, int64(1), usage(t, pool, actor.ID))
	})
	t.Run("single and whole batch race for final two", func(t *testing.T) {
		pool, _, links, actor := fixture(t)
		setLimit(t, pool, "2")
		start, out := make(chan struct{}), make(chan error, 2)
		go func() {
			<-start
			_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/single"})
			out <- err
		}()
		go func() {
			<-start
			_, err := links.BatchCreate(t.Context(), actor, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://quota.example/a", "https://quota.example/b"}})
			out <- err
		}()
		close(start)
		a, b := <-out, <-out
		require.True(t, a == nil && errors.Is(b, createquota.ErrExhausted) || b == nil && errors.Is(a, createquota.ErrExhausted))
		var n, receipts int64
		require.NoError(t, pool.QueryRow(t.Context(), `select count(*),(select count(*) from short_link_create_batch) from short_link`).Scan(&n, &receipts))
		require.Equal(t, n, usage(t, pool, actor.ID))
		require.True(t, n == 1 && receipts == 0 || n == 2 && receipts == 1)
	})
	t.Run("random conflict retry rolls usage back", func(t *testing.T) {
		pool, _, links, actor := fixture(t)
		setLimit(t, pool, "2")
		slug := "quota64collision"
		_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/existing", CustomSlug: &slug})
		require.NoError(t, err)
		_, err = pool.Exec(t.Context(), `create sequence quota_collision_attempt;create function quota_collision() returns trigger language plpgsql as $$begin if nextval('quota_collision_attempt')=1 then new.slug:='quota64collision';end if;return new;end$$;create trigger quota_collision before insert on short_link for each row execute function quota_collision()`)
		require.NoError(t, err)
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/random"})
		require.NoError(t, err)
		require.Equal(t, int64(2), usage(t, pool, actor.ID))
	})
	t.Run("custom conflict and audit failure roll back all", func(t *testing.T) {
		pool, _, links, actor := fixture(t)
		slug := "quota64custom"
		_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/existing", CustomSlug: &slug})
		require.NoError(t, err)
		before := state(t, pool)
		_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/conflict", CustomSlug: &slug})
		require.ErrorIs(t, err, shortlink.ErrSlugConflict)
		require.Equal(t, before, state(t, pool))
		_, err = pool.Exec(t.Context(), `create function quota_reject_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger quota_reject_audit before insert on audit_log for each row execute function quota_reject_audit()`)
		require.NoError(t, err)
		for _, batch := range []bool{false, true} {
			if batch {
				_, err = links.BatchCreate(t.Context(), actor, shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://quota.example/fail-a", "https://quota.example/fail-b"}})
			} else {
				_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/fail"})
			}
			require.Error(t, err)
			require.Equal(t, before, state(t, pool))
		}
	})
}

// TestDailyCreateQuotaGateOrdering catches early reads, inconsistent gates and
// a canceled wait proceeding into a creation or management write.
func TestDailyCreateQuotaGateOrdering(t *testing.T) {
	t.Run("reader before save", func(t *testing.T) {
		pool, service, _, actor := fixture(t)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		require.NoError(t, createquota.LockCreation(t.Context(), tx))
		out := make(chan error, 1)
		go func() {
			zero := int64(0)
			_, err := service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: &zero, ExpectedUpdatedAt: current.UpdatedAt})
			out <- err
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		require.NoError(t, tx.Commit(t.Context()))
		require.NoError(t, <-out)
	})
	for _, cancelWait := range []bool{false, true} {
		t.Run(fmt.Sprintf("save before create/cancel=%t", cancelWait), func(t *testing.T) {
			pool, _, links, actor := fixture(t)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), `select pg_advisory_xact_lock(1297040725,1129403727);update system_setting set value='{"dailyLimit":0}' where key='security.account_daily_create_quota'`)
			require.NoError(t, err)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			out := make(chan error, 1)
			go func() {
				_, err := links.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://quota.example/wait"})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			if cancelWait {
				cancel()
				require.Error(t, <-out)
				require.NoError(t, tx.Rollback(t.Context()))
			} else {
				require.NoError(t, tx.Commit(t.Context()))
				require.ErrorIs(t, <-out, createquota.ErrExhausted)
			}
			require.Equal(t, int64(0), usage(t, pool, actor.ID))
			var n int
			require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&n))
			require.Zero(t, n)
		})
	}
}

type quotaDayTraceKey struct{}
type dayOrderTracer struct {
	mu                sync.Mutex
	locked, afterLock bool
}

func (tr *dayOrderTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "-- name: GetAccountDailyCreateQuotaDay :one") {
		tr.mu.Lock()
		tr.afterLock = tr.locked
		tr.mu.Unlock()
	}
	if strings.Contains(data.SQL, "-- name: LockAccountDailyCreateUsage :one") {
		return context.WithValue(ctx, quotaDayTraceKey{}, true)
	}
	return ctx
}
func (tr *dayOrderTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	if ctx.Value(quotaDayTraceKey{}) == true && data.Err == nil {
		tr.mu.Lock()
		tr.locked = true
		tr.mu.Unlock()
	}
}

// TestDailyCreateQuotaDayBoundaries catches future-day reset, failure to roll
// yesterday forward, and taking a clock sample before the actual usage lock.
func TestDailyCreateQuotaDayBoundaries(t *testing.T) {
	for _, offset := range []int{-1, 0, 1} {
		t.Run(fmt.Sprintf("offset=%d", offset), func(t *testing.T) {
			pool, _, links, actor := fixture(t)
			setLimit(t, pool, "1")
			_, err := pool.Exec(t.Context(), `insert into account_daily_create_usage(actor_id,usage_day,used) values($1,(pg_catalog.clock_timestamp() at time zone 'UTC')::date+$2::integer,1)`, actor.ID, offset)
			require.NoError(t, err)
			before := state(t, pool)
			_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/day"})
			if offset < 0 {
				require.NoError(t, err)
				require.Equal(t, int64(1), usage(t, pool, actor.ID))
			} else {
				if offset == 0 {
					require.ErrorIs(t, err, createquota.ErrExhausted)
				} else {
					require.ErrorIs(t, err, createquota.ErrCorrupt)
				}
				require.Equal(t, before, state(t, pool))
			}
		})
	}
	t.Run("clock after waited row", func(t *testing.T) {
		pool, _, _, actor := fixture(t)
		setLimit(t, pool, "1")
		_, err := pool.Exec(t.Context(), `insert into account_daily_create_usage(actor_id,usage_day,used) values($1,(pg_catalog.clock_timestamp() at time zone 'UTC')::date-1,0)`, actor.ID)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		_, err = tx.Exec(t.Context(), `update account_daily_create_usage set usage_day=(pg_catalog.clock_timestamp() at time zone 'UTC')::date,used=1 where actor_id=$1`, actor.ID)
		require.NoError(t, err)
		trace := &dayOrderTracer{}
		config := pool.Config()
		config.ConnConfig.Tracer = trace
		traced, err := pgxpool.NewWithConfig(t.Context(), config)
		require.NoError(t, err)
		t.Cleanup(traced.Close)
		links := shortlink.NewService(traced, permission.NewDatabaseService(traced))
		out := make(chan error, 1)
		go func() {
			_, err := links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/waited-day"})
			out <- err
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		require.NoError(t, tx.Commit(t.Context()))
		require.ErrorIs(t, <-out, createquota.ErrExhausted)
		trace.mu.Lock()
		afterLock := trace.afterLock
		trace.mu.Unlock()
		require.True(t, afterLock, "actual database UTC date must be read after row-lock completion")
		require.Equal(t, int64(1), usage(t, pool, actor.ID))
	})
}

// TestDailyCreateQuotaAdminTransactions catches authority revoked while waiting,
// lost CAS, nonmonotonic versions and settings committed without their audit.
func TestDailyCreateQuotaAdminTransactions(t *testing.T) {
	for _, sql := range []string{`update app_user set status='disabled' where id=$1`, `update app_user set deleted_at=now() where id=$1`, `update app_user set group_id=(select id from user_group where key='user') where id=$1`, `update user_group set permissions='["admin:access"]' where key='admin' and exists(select 1 from app_user where id=$1)`} {
		t.Run(sql[:min(35, len(sql))], func(t *testing.T) {
			pool, service, _, actor := fixture(t)
			current, err := service.Get(t.Context(), actor)
			require.NoError(t, err)
			tx, err := pool.Begin(t.Context())
			require.NoError(t, err)
			defer testdb.Rollback(t, tx.Rollback)
			_, err = tx.Exec(t.Context(), sql, actor.ID)
			require.NoError(t, err)
			out := make(chan error, 1)
			go func() {
				one := int64(1)
				_, err := service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: &one, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
			waitBlocked(t, pool, tx.Conn().PgConn().PID())
			require.NoError(t, tx.Commit(t.Context()))
			require.ErrorIs(t, <-out, createquota.ErrPermissionDenied)
			_, err = service.Get(t.Context(), actor)
			require.ErrorIs(t, err, createquota.ErrPermissionDenied)
		})
	}
	t.Run("CAS audit failure and future version", func(t *testing.T) {
		pool, service, _, actor := fixture(t)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		start, out := make(chan struct{}), make(chan error, 2)
		for _, limit := range []int64{1, 2} {
			go func() {
				<-start
				_, err := service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: &limit, ExpectedUpdatedAt: current.UpdatedAt})
				out <- err
			}()
		}
		close(start)
		a, b := <-out, <-out
		require.True(t, a == nil && errors.Is(b, createquota.ErrConflict) || b == nil && errors.Is(a, createquota.ErrConflict))
		saved, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		before := state(t, pool)
		_, err = pool.Exec(t.Context(), `create function quota_reject_audit() returns trigger language plpgsql as $$begin raise exception 'audit unavailable';end$$;create trigger quota_reject_audit before insert on audit_log for each row execute function quota_reject_audit()`)
		require.NoError(t, err)
		_, err = service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: nil, ExpectedUpdatedAt: saved.UpdatedAt})
		require.Error(t, err)
		again, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		require.Equal(t, saved, again)
		require.Equal(t, before, state(t, pool))
		_, err = pool.Exec(t.Context(), `drop trigger quota_reject_audit on audit_log;drop function quota_reject_audit();update system_setting set updated_at='2035-01-01T00:00:00.123456Z' where key='security.account_daily_create_quota'`)
		require.NoError(t, err)
		again, err = service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: nil, ExpectedUpdatedAt: "2035-01-01T00:00:00.123456Z"})
		require.NoError(t, err)
		require.Equal(t, "2035-01-01T00:00:00.123457Z", again.UpdatedAt)
	})
}

// TestDailyCreateQuotaMissingAndInvalidIdentity catches trusting caller-supplied
// admin grants or hiding corrupt state while enforcement is disabled.
func TestDailyCreateQuotaMissingAndInvalidIdentity(t *testing.T) {
	pool, service, _, actor := fixture(t)
	for _, id := range []string{"guest", "", uuid.Nil.String(), strings.ToUpper(actor.ID)} {
		bad := actor
		bad.ID = id
		_, err := service.Get(t.Context(), bad)
		require.ErrorIs(t, err, createquota.ErrPermissionDenied)
		_, err = service.Update(t.Context(), bad, createquota.UpdateInput{ExpectedUpdatedAt: "2026-11-12T00:00:00Z"})
		require.ErrorIs(t, err, createquota.ErrPermissionDenied)
	}
	bad := int64(-1)
	_, err := service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: &bad, ExpectedUpdatedAt: "2026-11-12T00:00:00Z"})
	require.ErrorIs(t, err, createquota.ErrInvalidInput)
	_, err = service.Update(t.Context(), actor, createquota.UpdateInput{ExpectedUpdatedAt: "bad"})
	require.ErrorIs(t, err, createquota.ErrInvalidInput)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	for _, value := range []string{`{"dailyLimit":-1}`, `{"dailyLimit":null,"extra":1}`} {
		_, err = pool.Exec(t.Context(), `update system_setting set value=$1::jsonb where key='security.account_daily_create_quota'`, value)
		require.NoError(t, err)
		require.ErrorIs(t, service.ValidateStartup(t.Context()), createquota.ErrCorrupt)
		_, err = service.Get(t.Context(), actor)
		require.ErrorIs(t, err, createquota.ErrCorrupt)
		_, err = service.Update(t.Context(), actor, createquota.UpdateInput{ExpectedUpdatedAt: current.UpdatedAt})
		require.ErrorIs(t, err, createquota.ErrCorrupt)
	}
	_, err = pool.Exec(t.Context(), `delete from system_setting where key='security.account_daily_create_quota'`)
	require.NoError(t, err)
	require.ErrorIs(t, service.ValidateStartup(t.Context()), pgx.ErrNoRows)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, pgx.ErrNoRows)
	_, err = service.Update(t.Context(), actor, createquota.UpdateInput{ExpectedUpdatedAt: current.UpdatedAt})
	require.ErrorIs(t, err, pgx.ErrNoRows)
	for _, count := range []int{0, 21} {
		err := createquota.Consume(t.Context(), sqlc.New(pool), pgtype.UUID{}, count)
		require.ErrorIs(t, err, createquota.ErrInvalidInput)
	}
}
