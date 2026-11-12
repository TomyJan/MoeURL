package createquota_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/createquota"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// usageReadState includes the policy and complete meters/audit so a GET that
// inserts, normalizes a historical row or changes a setting cannot pass.
func usageReadState(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	var result string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_object('usage',(select coalesce(jsonb_agg(to_jsonb(u) order by actor_id),'[]') from account_daily_create_usage u),'settings',(select jsonb_agg(to_jsonb(s) order by key) from system_setting s),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_log a))::text`).Scan(&result))
	return result
}

// TestOwnDailyCreateUsageSnapshots catches reads mutating the ledger, losing
// int64 digits, subtracting through zero, or applying another account's meter.
func TestOwnDailyCreateUsageSnapshots(t *testing.T) {
	for _, tc := range []struct {
		name, policy, offset, used, want string
		remaining                        *int64
	}{
		{"missing unlimited", "null", "", "", "0", nil},
		{"missing finite", "12", "", "", "0", ptrUsage(12)},
		{"current finite", "12", "0", "3", "3", ptrUsage(9)},
		{"current zero", "0", "0", "0", "0", ptrUsage(0)},
		{"exhausted", "3", "0", "3", "3", ptrUsage(0)},
		{"lowered below usage", "2", "0", "3", "3", ptrUsage(0)},
		{"int64 unlimited", "null", "0", "9223372036854775807", "9223372036854775807", nil},
		{"int64 limited", "1000000", "0", "9223372036854775807", "9223372036854775807", ptrUsage(0)},
		{"historical finite", "12", "-1", "17", "0", ptrUsage(12)},
		{"historical unlimited", "null", "-1", "17", "0", nil},
	} {
		t.Run(tc.name, func(t *testing.T) {
			pool, service, _, actor := fixture(t)
			setLimit(t, pool, tc.policy)
			if tc.offset != "" {
				_, err := pool.Exec(t.Context(), `insert into account_daily_create_usage values($1,(clock_timestamp() at time zone 'UTC')::date+$2::integer,$3::bigint)`, actor.ID, tc.offset, tc.used)
				require.NoError(t, err)
			}
			before := usageReadState(t, pool)
			value, err := service.GetOwnUsage(t.Context(), actor)
			require.NoError(t, err)
			var day string
			require.NoError(t, pool.QueryRow(t.Context(), `select (clock_timestamp() at time zone 'UTC')::date::text`).Scan(&day))
			require.Equal(t, day, value.UsageDay)
			require.Equal(t, tc.want, value.Used)
			require.Equal(t, tc.remaining, value.Remaining)
			if tc.policy == "null" {
				require.Nil(t, value.DailyLimit)
			} else {
				require.NotNil(t, value.DailyLimit)
				require.Equal(t, tc.policy, fmt.Sprint(*value.DailyLimit))
			}
			require.Equal(t, before, usageReadState(t, pool))
		})
	}
	t.Run("independent owners and no row lock", func(t *testing.T) {
		pool, service, _, first := fixture(t)
		second := secondActor(t, pool, first)
		_, err := pool.Exec(t.Context(), `insert into account_daily_create_usage values($1,(clock_timestamp() at time zone 'UTC')::date,3),($2,(clock_timestamp() at time zone 'UTC')::date,17)`, first.ID, second.ID)
		require.NoError(t, err)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer testdb.Rollback(t, tx.Rollback)
		_, err = tx.Exec(t.Context(), `update account_daily_create_usage set used=99 where actor_id=$1`, first.ID)
		require.NoError(t, err)
		ctx, cancel := context.WithTimeout(t.Context(), time.Second)
		defer cancel()
		one, err := service.GetOwnUsage(ctx, first)
		require.NoError(t, err)
		require.Equal(t, "3", one.Used)
		two, err := service.GetOwnUsage(ctx, second)
		require.NoError(t, err)
		require.Equal(t, "17", two.Used)
		require.NoError(t, tx.Rollback(t.Context()))
	})
}

func ptrUsage(value int64) *int64 { return &value }

// TestOwnDailyCreateUsageCurrentAuthorization catches trusting stale auth
// claims or requiring the admin role for an ordinary user's own usage.
func TestOwnDailyCreateUsageCurrentAuthorization(t *testing.T) {
	pool, service, _, actor := fixture(t)
	_, err := pool.Exec(t.Context(), `update app_user set group_id=(select id from user_group where key='user') where id=$1`, actor.ID)
	require.NoError(t, err)
	_, err = service.GetOwnUsage(t.Context(), actor)
	require.NoError(t, err, "stale admin claim must not prevent an ordinary current creator")
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where key='user'`)
	require.NoError(t, err)
	_, err = service.GetOwnUsage(t.Context(), actor)
	require.ErrorIs(t, err, createquota.ErrPermissionDenied)
	for _, raw := range []string{"", "guest", uuid.Nil.String(), uuid.NewString(), strings.ToUpper(actor.ID)} {
		_, err = service.GetOwnUsage(t.Context(), auth.CurrentUser{ID: raw, Permissions: []string{"short_link:create"}})
		require.ErrorIs(t, err, createquota.ErrPermissionDenied)
	}
	for _, change := range []string{"status='disabled'", "deleted_at=now()", "builtin=true"} {
		t.Run(change, func(t *testing.T) {
			pool, service, _, actor := fixture(t)
			_, err := pool.Exec(t.Context(), `update app_user set `+change+` where id=$1`, actor.ID)
			require.NoError(t, err)
			_, err = service.GetOwnUsage(t.Context(), actor)
			require.ErrorIs(t, err, createquota.ErrPermissionDenied)
		})
	}
}

// TestOwnDailyCreateUsageBadStorage catches unsafe zero fallbacks for corrupt
// rows/policy and ensures cancellation never returns a partially built result.
func TestOwnDailyCreateUsageBadStorage(t *testing.T) {
	for _, sql := range []string{
		`insert into account_daily_create_usage values($1,(clock_timestamp() at time zone 'UTC')::date+1,1)`,
		`alter table account_daily_create_usage drop constraint account_daily_create_usage_used_check;insert into account_daily_create_usage values($1,(clock_timestamp() at time zone 'UTC')::date-1,-1)`,
		`alter table account_daily_create_usage drop constraint account_daily_create_usage_usage_day_check;insert into account_daily_create_usage values($1,'infinity',1)`,
		`update system_setting set value='{"dailyLimit":-1}' where key='security.account_daily_create_quota' and $1::uuid is not null`,
		`update user_group set permissions='{}' where key='admin' and $1::uuid is not null`,
		`delete from system_setting where key='security.account_daily_create_quota' and $1::uuid is not null`,
		`alter table account_daily_create_usage rename to hidden_usage`,
		`alter table app_user rename to hidden_user`,
	} {
		t.Run(sql[:min(48, len(sql))], func(t *testing.T) {
			pool, service, _, actor := fixture(t)
			for _, statement := range strings.Split(sql, ";") {
				if strings.Contains(statement, "$1") {
					_, err := pool.Exec(t.Context(), statement, actor.ID)
					require.NoError(t, err)
				} else {
					_, err := pool.Exec(t.Context(), statement)
					require.NoError(t, err)
				}
			}
			value, err := service.GetOwnUsage(t.Context(), actor)
			require.Error(t, err)
			require.Equal(t, createquota.Usage{}, value)
		})
	}
	for _, after := range []string{"-- name: GetCreateQuotaReader :one", "-- name: GetSystemSetting :one", "-- name: GetAccountDailyCreateUsage :one"} {
		t.Run("cancel after "+after, func(t *testing.T) {
			pool, _, _, actor := fixture(t)
			before := usageReadState(t, pool)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			config := pool.Config()
			config.ConnConfig.Tracer = &quotaCancellationTracer{after, cancel}
			traced, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(traced.Close)
			value, err := createquota.NewService(traced).GetOwnUsage(ctx, actor)
			require.ErrorIs(t, err, context.Canceled)
			require.Equal(t, createquota.Usage{}, value)
			require.Equal(t, before, usageReadState(t, pool))
		})
	}
	t.Run("closed pool", func(t *testing.T) {
		pool, _, _, actor := fixture(t)
		config := pool.Config()
		closed, err := pgxpool.NewWithConfig(t.Context(), config)
		require.NoError(t, err)
		closed.Close()
		value, err := createquota.NewService(closed).GetOwnUsage(t.Context(), actor)
		require.Error(t, err)
		require.Equal(t, createquota.Usage{}, value)
	})
}
