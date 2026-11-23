package user_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

type adminGroupLockBarrierKey struct{}

// adminGroupLockBarrier holds concurrent admin-group reads until both transactions reach them.
type adminGroupLockBarrier struct {
	mu          sync.Mutex
	arrivals    int
	bothArrived chan struct{}
	release     chan struct{}
	releaseOnce sync.Once
}

func (tracer *adminGroupLockBarrier) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	if strings.Contains(data.SQL, "-- name: LockGroupChangeGroup") {
		return context.WithValue(ctx, adminGroupLockBarrierKey{}, tracer)
	}
	return ctx
}

func (tracer *adminGroupLockBarrier) TraceQueryEnd(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryEndData) {
	if data.Err != nil || ctx.Value(adminGroupLockBarrierKey{}) != tracer {
		return
	}

	tracer.mu.Lock()
	tracer.arrivals++
	arrivals := tracer.arrivals
	if arrivals == 2 {
		close(tracer.bothArrived)
	}
	tracer.mu.Unlock()

	if arrivals == 1 {
		select {
		case <-tracer.bothArrived:
		case <-time.After(2 * time.Second):
		}
		tracer.releaseOnce.Do(func() { close(tracer.release) })
		return
	}
	<-tracer.release
}

// TestConcurrentCreateInAdminGroupAvoidsLockUpgradeDeadlock ensures concurrent administrators can create admin members.
func TestConcurrentCreateInAdminGroupAvoidsLockUpgradeDeadlock(t *testing.T) {
	pool, _, firstActor, _ := groupFixture(t)
	secondActorID := insertAppUser(t, t.Context(), pool, "manager-two", "", "Manager Two", "admin", "active", false)
	secondActor := auth.CurrentUser{ID: secondActorID, GroupKey: permission.GroupAdmin}

	tracer := &adminGroupLockBarrier{
		bothArrived: make(chan struct{}),
		release:     make(chan struct{}),
	}
	config := pool.Config()
	config.ConnConfig.Tracer = tracer
	tracedPool, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	t.Cleanup(tracedPool.Close)
	service := user.NewService(tracedPool, permission.NewDatabaseService(tracedPool))

	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	t.Cleanup(cancel)
	actors := []auth.CurrentUser{firstActor, secondActor}
	results := make(chan error, len(actors))
	for index, actor := range actors {
		go func(index int, actor auth.CurrentUser) {
			_, err := service.Create(ctx, actor, user.CreateInput{
				Username: "admin-member-" + string(rune('a'+index)),
				Password: "secure-password",
				Nickname: "Admin Member",
				GroupKey: permission.GroupAdmin,
				Status:   "active",
			})
			results <- err
		}(index, actor)
	}

	for range actors {
		select {
		case err := <-results:
			require.NoError(t, err)
		case <-ctx.Done():
			t.Fatalf("concurrent admin user creation did not finish: %v", ctx.Err())
		}
	}
	require.Equal(t, 2, tracer.arrivals, "both requests must recheck and lock the live admin-group row")
	var created int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from app_user where username in ('admin-member-a','admin-member-b')`).Scan(&created))
	require.Equal(t, 2, created)
}
