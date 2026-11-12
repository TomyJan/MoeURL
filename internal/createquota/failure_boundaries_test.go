package createquota_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/createquota"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

// TestDailyCreateQuotaIndependentAccounts catches a shared counter or lost
// row update allowing two same-account requests to spend its final slot.
func TestDailyCreateQuotaIndependentAccounts(t *testing.T) {
	pool, _, links, first := fixture(t)
	second := secondActor(t, pool, first)
	setLimit(t, pool, "1")
	type outcome struct {
		id  string
		err error
	}
	start, out := make(chan struct{}), make(chan outcome, 4)
	for _, actor := range []struct {
		id     string
		second bool
	}{{first.ID, false}, {second.ID, true}} {
		for n := range 2 {
			go func() {
				<-start
				user := first
				if actor.second {
					user = second
				}
				_, err := links.Create(t.Context(), user, shortlink.CreateInput{TargetURL: fmt.Sprintf("https://quota.example/%s/%d", actor.id, n)})
				out <- outcome{actor.id, err}
			}()
		}
	}
	close(start)
	successes, denied := map[string]int{}, map[string]int{}
	for range 4 {
		result := <-out
		if result.err == nil {
			successes[result.id]++
		} else {
			require.ErrorIs(t, result.err, createquota.ErrExhausted)
			denied[result.id]++
		}
	}
	for _, id := range []string{first.ID, second.ID} {
		require.Equal(t, 1, successes[id])
		require.Equal(t, 1, denied[id])
		require.Equal(t, int64(1), usage(t, pool, id))
	}
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
	require.Equal(t, 2, count)
}

// TestDailyCreateQuotaTwentyAndPartialConflict catches off-by-one batch
// accounting and a later custom-slug failure committing earlier items/usage.
func TestDailyCreateQuotaTwentyAndPartialConflict(t *testing.T) {
	pool, _, links, actor := fixture(t)
	urls := make([]string, 20)
	for i := range urls {
		urls[i] = fmt.Sprintf("https://quota.example/twenty/%d", i)
	}
	input := shortlink.BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: urls}
	setLimit(t, pool, "19")
	before := state(t, pool)
	_, err := links.BatchCreate(t.Context(), actor, input)
	require.ErrorIs(t, err, createquota.ErrExhausted)
	require.Equal(t, before, state(t, pool))
	setLimit(t, pool, "20")
	first, err := links.BatchCreate(t.Context(), actor, input)
	require.NoError(t, err)
	require.EqualValues(t, 20, first.CreatedCount)
	require.Equal(t, int64(20), usage(t, pool, actor.ID))
	before = state(t, pool)
	replayed, err := links.BatchCreate(t.Context(), actor, input)
	require.NoError(t, err)
	require.Equal(t, first, replayed)
	require.Equal(t, before, state(t, pool))
	setLimit(t, pool, "22")
	var slug string
	require.NoError(t, pool.QueryRow(t.Context(), `select slug from short_link order by id limit 1`).Scan(&slug))
	_, err = links.BatchCreateWithCustomSlugs(t.Context(), actor, shortlink.BatchCreateWithCustomSlugsInput{
		RequestID: uuid.NewString(), Items: []shortlink.BatchCreateCustomSlugItem{
			{TargetURL: "https://quota.example/before-conflict", Tags: []string{}, CustomSlug: "quota64first"},
			{TargetURL: "https://quota.example/conflict", Tags: []string{}, CustomSlug: slug},
		},
	})
	require.ErrorIs(t, err, shortlink.ErrSlugConflict)
	require.Equal(t, before, state(t, pool))
}

// TestDailyCreateQuotaNoopAndCorruptGrants catches no-op writes changing the
// revision/audit and malformed current grants being treated as an admin grant.
func TestDailyCreateQuotaNoopAndCorruptGrants(t *testing.T) {
	pool, service, _, actor := fixture(t)
	current, err := service.Get(t.Context(), actor)
	require.NoError(t, err)
	before := state(t, pool)
	saved, err := service.Update(t.Context(), actor, createquota.UpdateInput{DailyLimit: nil, ExpectedUpdatedAt: current.UpdatedAt})
	require.NoError(t, err)
	require.Equal(t, current, saved)
	require.Equal(t, before, state(t, pool))
	_, err = pool.Exec(t.Context(), `update user_group set permissions='[1]' where key='admin'`)
	require.NoError(t, err)
	_, err = service.Get(t.Context(), actor)
	require.ErrorIs(t, err, createquota.ErrCorrupt)
	_, err = service.Update(t.Context(), actor, createquota.UpdateInput{ExpectedUpdatedAt: current.UpdatedAt})
	require.ErrorIs(t, err, createquota.ErrCorrupt)
	require.Equal(t, before, state(t, pool))
}

// TestDailyCreateQuotaUnavailablePolicy catches missing or corrupt settings
// being silently treated as unlimited on the real creation path.
func TestDailyCreateQuotaUnavailablePolicy(t *testing.T) {
	for _, statement := range []string{
		`delete from system_setting where key='security.account_daily_create_quota'`,
		`update system_setting set value='{"dailyLimit":-1}' where key='security.account_daily_create_quota'`,
	} {
		t.Run(statement[:min(25, len(statement))], func(t *testing.T) {
			pool, _, links, actor := fixture(t)
			_, err := pool.Exec(t.Context(), statement)
			require.NoError(t, err)
			before := state(t, pool)
			_, err = links.Create(t.Context(), actor, shortlink.CreateInput{TargetURL: "https://quota.example/bad-policy"})
			require.Error(t, err)
			require.True(t, errors.Is(err, pgx.ErrNoRows) || errors.Is(err, createquota.ErrCorrupt))
			require.Equal(t, before, state(t, pool))
		})
	}
}

type quotaCancellationKey struct{}
type quotaCancellationTracer struct {
	after  string
	cancel context.CancelFunc
}

func (tr *quotaCancellationTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, tr.after) {
		return context.WithValue(ctx, quotaCancellationKey{}, true)
	}
	return ctx
}
func (tr *quotaCancellationTracer) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	if ctx.Value(quotaCancellationKey{}) == true && data.Err == nil {
		tr.cancel()
	}
}

// TestDailyCreateQuotaCancellationBoundaries executes real SQL then cancels
// at controlled boundaries; no partial ledger, link, receipt or audit may remain.
func TestDailyCreateQuotaCancellationBoundaries(t *testing.T) {
	for _, after := range []string{"-- name: GetSystemSetting :one", "-- name: EnsureAccountDailyCreateUsage :exec", "-- name: LockAccountDailyCreateUsage :one"} {
		t.Run(after, func(t *testing.T) {
			pool, _, _, actor := fixture(t)
			before := state(t, pool)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			config := pool.Config()
			config.ConnConfig.Tracer = &quotaCancellationTracer{after, cancel}
			traced, err := pgxpool.NewWithConfig(t.Context(), config)
			require.NoError(t, err)
			t.Cleanup(traced.Close)
			err = appdb.WithAuditTx(ctx, traced, actor.ID, func(tx pgx.Tx) error {
				if err := createquota.LockCreation(ctx, tx); err != nil {
					return err
				}
				return createquota.Consume(ctx, sqlc.New(tx), pgtype.UUID{Bytes: uuid.MustParse(actor.ID), Valid: true}, 1)
			})
			require.ErrorIs(t, err, context.Canceled)
			require.Equal(t, before, state(t, pool))
		})
	}
	t.Run("cancel identity read after real exclusive gate", func(t *testing.T) {
		pool, service, _, actor := fixture(t)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		before := state(t, pool)
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		config := pool.Config()
		config.ConnConfig.Tracer = &quotaCancellationTracer{"select pg_advisory_xact_lock(", cancel}
		traced, err := pgxpool.NewWithConfig(t.Context(), config)
		require.NoError(t, err)
		t.Cleanup(traced.Close)
		_, err = createquota.NewService(traced).Update(ctx, actor, createquota.UpdateInput{ExpectedUpdatedAt: current.UpdatedAt})
		require.ErrorIs(t, err, context.Canceled)
		require.Equal(t, before, state(t, pool))
	})
	t.Run("cancel policy save while waiting for active creation", func(t *testing.T) {
		pool, service, _, actor := fixture(t)
		current, err := service.Get(t.Context(), actor)
		require.NoError(t, err)
		before := state(t, pool)
		tx, err := pool.Begin(t.Context())
		require.NoError(t, err)
		defer tx.Rollback(t.Context())
		require.NoError(t, createquota.LockCreation(t.Context(), tx))
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		out := make(chan error, 1)
		go func() {
			one := int64(1)
			_, err := service.Update(ctx, actor, createquota.UpdateInput{DailyLimit: &one, ExpectedUpdatedAt: current.UpdatedAt})
			out <- err
		}()
		waitBlocked(t, pool, tx.Conn().PgConn().PID())
		cancel()
		require.ErrorIs(t, <-out, context.Canceled)
		require.NoError(t, tx.Rollback(t.Context()))
		require.Equal(t, before, state(t, pool))
	})
}
