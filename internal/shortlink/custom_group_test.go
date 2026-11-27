package shortlink_test

import (
	"context"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestCustomGroupCanCreateShortLinkOnGrantedDomain(t *testing.T) {
	ctx := t.Context()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	groupID, groupKey, userID, domainID := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,description,permissions,builtin,created_at,updated_at)
		values($1,$2,'Operations','',$3::jsonb,false,now(),now())`, groupID, groupKey, ` ["short_link:create","domain:use_assigned"] `)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at)
		values($1,'operations.example.com','Operations','short_link',true,false,now(),now())`, domainID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) values($1,$2)`, domainID, groupID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at)
		values($1,'custom-owner','hash','Custom Owner',$2,'active',false,now(),now())`, userID, groupID)
	require.NoError(t, err)

	actor := auth.CurrentUser{ID: userID, GroupKey: groupKey}
	requestedDomain := domainID
	result, err := shortlink.NewService(pool, permission.NewDatabaseService(pool)).Create(ctx, actor, shortlink.CreateInput{
		TargetURL: "https://destination.example/path", DomainID: &requestedDomain,
	})
	require.NoError(t, err)
	var storedDomain string
	require.NoError(t, pool.QueryRow(ctx, `select domain_id::text from short_link where id=$1`, result.ShortLink.ID).Scan(&storedDomain))
	require.Equal(t, domainID, storedDomain)
}

func TestCreateRechecksSupplementalMembershipAfterActorLockWait(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	pool := shortLinkTestPool(t, ctx)
	insertShortLinkDefaultDomain(t, ctx, pool)
	primaryID, supplementalID, userID := uuid.New(), uuid.New(), uuid.New()
	supplementalKey := uuid.NewString()
	_, err := pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User','[]',true,now(),now())`, primaryID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,$2,'Creator','["short_link:create","domain:use_default"]',false,now(),now())`, supplementalID, supplementalKey)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,$2,'Member',$3,'active',false,now(),now())`, userID, "wait-"+userID.String(), primaryID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user_group_membership(user_id,user_group_id) values($1,$2)`, userID, supplementalID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) values('00000000-0000-0000-0000-000000000301',$1)`, supplementalID)
	require.NoError(t, err)
	actor := auth.CurrentUser{ID: userID.String(), GroupKey: "user"}
	service := shortlink.NewService(pool, permission.NewDatabaseService(pool))
	gate, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer gate.Rollback(context.Background())
	_, err = gate.Exec(ctx, `select id from app_user where id=$1 for update`, userID)
	require.NoError(t, err)
	done := make(chan error, 1)
	go func() {
		_, err := service.Create(ctx, actor, shortlink.CreateInput{TargetURL: "https://destination.example/"})
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := pool.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockTargetPolicyActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond)
	_, err = gate.Exec(ctx, `delete from app_user_group_membership where user_id=$1 and user_group_id=$2`, userID, supplementalID)
	require.NoError(t, err)
	require.NoError(t, gate.Commit(ctx))
	require.ErrorIs(t, <-done, shortlink.ErrPermissionDenied)
	var created int
	require.NoError(t, pool.QueryRow(ctx, `select count(*) from short_link where owner_id=$1`, userID).Scan(&created))
	require.Zero(t, created)
}
