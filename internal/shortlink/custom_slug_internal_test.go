package shortlink

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

// TestCreateSlugEntropyAndConflictPaths verifies random retries and that custom creates never consume entropy.
func TestCreateSlugEntropyAndConflictPaths(t *testing.T) {
	ctx := t.Context()
	pool := testdb.ProjectMigratedPool(ctx, t)
	groupID, userID, domainID := uuid.New(), uuid.New(), uuid.New()
	permissions, err := json.Marshal(permission.UserPermissions)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User',$2,true,now(),now())`, groupID, permissions)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into app_user(id,username,password_hash,nickname,group_id,status,builtin,created_at,updated_at) values($1,'entropy','hash','Entropy',$2,'active',false,now(),now())`, userID, groupID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'go.example.com','Default','short_link',true,true,now(),now())`, domainID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `insert into domain_user_group(domain_id,user_group_id) values($1,$2)`, domainID, groupID)
	require.NoError(t, err)
	original := slugRandomReader
	t.Cleanup(func() { slugRandomReader = original })
	service := NewService(pool, permission.NewService())
	user := auth.CurrentUser{ID: userID.String(), GroupKey: permission.GroupUser}
	slugRandomReader = slugErrReader{}
	_, err = service.Create(ctx, user, CreateInput{TargetURL: "https://example.com"})
	require.EqualError(t, err, "random failed")
	custom := "abcdef"
	_, err = service.Create(ctx, user, CreateInput{TargetURL: "https://example.com", CustomSlug: &custom})
	require.NoError(t, err)
	_, err = service.Create(ctx, user, CreateInput{TargetURL: "https://example.com", CustomSlug: &custom})
	require.ErrorIs(t, err, ErrSlugConflict)
	slugRandomReader = bytes.NewReader(append([]byte{0, 1, 2, 3, 4, 5}, []byte{0, 1, 2, 27, 28, 29}...))
	created, err := service.Create(ctx, user, CreateInput{TargetURL: "https://example.com"})
	require.NoError(t, err)
	require.Equal(t, "abc123", created.ShortLink.Slug)
	slugRandomReader = bytes.NewReader(bytes.Repeat([]byte{0, 1, 2, 3, 4, 5}, maxSlugAttempts))
	_, err = service.Create(ctx, user, CreateInput{TargetURL: "https://example.com"})
	require.ErrorIs(t, err, ErrSlugConflict)
	_, err = pool.Exec(ctx, `create function reject_short_link_insert() returns trigger language plpgsql as $$ begin raise unique_violation using constraint='unrelated_constraint'; end $$; create trigger reject_short_link_insert before insert on short_link for each row execute function reject_short_link_insert()`)
	require.NoError(t, err)
	custom = "unused123"
	_, err = service.Create(ctx, user, CreateInput{TargetURL: "https://example.com", CustomSlug: &custom})
	var databaseError *pgconn.PgError
	require.ErrorAs(t, err, &databaseError)
	require.Equal(t, "unrelated_constraint", databaseError.ConstraintName)
}
