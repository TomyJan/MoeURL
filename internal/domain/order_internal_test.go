package domain

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/db/sqlc"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/stretchr/testify/require"
)

// Faults replace only the database boundary. All unaffected reads execute real
// SQL, so returning success/default values cannot satisfy the error contracts.
type orderFaultStore struct {
	domainOrderStore
	stage   string
	failure error
}

func (s orderFaultStore) LockDomainOrderActor(ctx context.Context, id pgtype.UUID) (sqlc.LockDomainOrderActorRow, error) {
	if s.stage == "actor" {
		return sqlc.LockDomainOrderActorRow{}, s.failure
	}
	return s.domainOrderStore.LockDomainOrderActor(ctx, id)
}
func (s orderFaultStore) LockDomainOrderGroup(ctx context.Context, id pgtype.UUID) ([]byte, error) {
	if s.stage == "group" {
		return nil, s.failure
	}
	return s.domainOrderStore.LockDomainOrderGroup(ctx, id)
}
func (s orderFaultStore) GetManagedDomainForUpdate(ctx context.Context, id pgtype.UUID) (sqlc.Domain, error) {
	if s.stage == "target" {
		return sqlc.Domain{}, s.failure
	}
	return s.domainOrderStore.GetManagedDomainForUpdate(ctx, id)
}
func (s orderFaultStore) ListDomainGrantKeys(ctx context.Context, id pgtype.UUID) ([]string, error) {
	if s.stage == "grants" {
		return nil, s.failure
	}
	return s.domainOrderStore.ListDomainGrantKeys(ctx, id)
}
func (s orderFaultStore) DomainHasReferences(ctx context.Context, id pgtype.UUID) (bool, error) {
	if s.stage == "references" {
		return false, s.failure
	}
	return s.domainOrderStore.DomainHasReferences(ctx, id)
}
func (s orderFaultStore) SetDomainSortOrder(ctx context.Context, arg sqlc.SetDomainSortOrderParams) (sqlc.Domain, error) {
	if s.stage == "write" {
		return sqlc.Domain{}, s.failure
	}
	return s.domainOrderStore.SetDomainSortOrder(ctx, arg)
}

// Catches infrastructure failures being swallowed or mislabeled as business errors.
func TestDomainOrderDatabaseFailures(t *testing.T) {
	_, pool, actor, input := internalDomainFixture(t)
	ctx := t.Context()
	_, err := pool.Exec(ctx, `update user_group set permissions='["admin:access","domain:manage"]' where key='admin'`)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) select $1,'order-fault','Fault',id,'active',false,now(),now() from user_group where key='admin'`, actor.ID)
	require.NoError(t, err)
	actorID, _, err := validateSetOrderInput(SetOrderInput{ID: actor.ID, ExpectedUpdatedAt: input.ExpectedUpdatedAt})
	require.NoError(t, err)
	domainID, version, err := validateSetOrderInput(SetOrderInput{ID: input.ID, ExpectedUpdatedAt: input.ExpectedUpdatedAt})
	require.NoError(t, err)
	sentinel := errors.New("controlled database fault")
	for _, stage := range []string{"actor", "group", "target", "grants", "references", "write"} {
		t.Run(stage, func(t *testing.T) {
			result, err := applyDomainOrder(ctx, orderFaultStore{sqlc.New(pool), stage, sentinel}, pgUUID(actorID), pgUUID(domainID), version, 7)
			require.ErrorIs(t, err, sentinel)
			require.Empty(t, result.ID)
		})
	}
	_, err = applyDomainOrder(ctx, orderFaultStore{sqlc.New(pool), "write", pgx.ErrNoRows}, pgUUID(actorID), pgUUID(domainID), version, 7)
	require.ErrorIs(t, err, ErrVersionConflict)
	var sort int32
	var updated time.Time
	require.NoError(t, pool.QueryRow(ctx, `select sort_order,updated_at from domain where id=$1`, input.ID).Scan(&sort, &updated))
	require.Zero(t, sort)
	require.Equal(t, version, updated.UTC())
	// Real pool acquisition failure must escape the transaction boundary.
	pool.Close()
	_, err = NewService(pool, nil).SetOrder(ctx, actor, SetOrderInput{ID: input.ID, SortOrder: 7, ExpectedUpdatedAt: input.ExpectedUpdatedAt})
	require.Error(t, err)
	require.NotErrorIs(t, err, ErrPermissionDenied)
}
