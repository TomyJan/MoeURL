package shortlink_test

import (
	"testing"

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
