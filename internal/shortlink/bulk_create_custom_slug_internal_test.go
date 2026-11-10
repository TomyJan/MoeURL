package shortlink

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkCustomSlugEntropy protects future requested codes from earlier random rows and forbids custom fallback.
func TestBulkCustomSlugEntropy(t *testing.T) {
	for _, kind := range []string{"mixed future reservation", "custom without entropy", "custom conflict without entropy", "revoked custom grant"} {
		t.Run(kind, func(t *testing.T) {
			pool := testdb.ProjectMigratedPool(t.Context(), t)
			groupID, userID, domainID := uuid.New(), uuid.New(), uuid.New()
			grants, err := json.Marshal(permission.UserPermissions)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values($1,'user','User',$2,true,now(),now())`, groupID, grants)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), `insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values($1,'custom-entropy','Entropy',$2,'active',false,now(),now())`, userID, groupID)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), `insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values($1,'https://entropy56.example.org','Entropy','short_link',true,true,now(),now())`, domainID)
			require.NoError(t, err)
			_, err = pool.Exec(t.Context(), `insert into domain_user_group(domain_id,user_group_id) values($1,$2)`, domainID, groupID)
			require.NoError(t, err)
			original := slugRandomReader
			t.Cleanup(func() { slugRandomReader = original })
			input := BatchCreateWithCustomSlugsInput{RequestID: uuid.NewString(), Items: []BatchCreateCustomSlugItem{{TargetURL: "https://example.org/custom", Tags: []string{}, CustomSlug: "AAAAAA"}}}
			service := NewService(pool, permission.NewDatabaseService(pool))
			actor := auth.CurrentUser{ID: userID.String()}
			if kind == "revoked custom grant" {
				_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions - 'short_link:custom_slug' where id=$1`, groupID)
				require.NoError(t, err)
			}
			slugRandomReader = slugErrReader{}
			if kind == "mixed future reservation" {
				input.Items = append([]BatchCreateCustomSlugItem{{TargetURL: "https://example.org/random", Tags: []string{}}}, input.Items...)
				slugRandomReader = bytes.NewReader(append(make([]byte, 6), bytes.Repeat([]byte{1}, 6)...))
			}
			if kind == "custom conflict without entropy" {
				_, err = pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values(gen_random_uuid(),$1,$2,'aaaaaa','https://example.org/occupied','active',now(),now())`, userID, domainID)
				require.NoError(t, err)
			}
			result, err := service.BatchCreateWithCustomSlugs(t.Context(), actor, input)
			var links, audits, receipts int
			require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			if kind == "revoked custom grant" {
				require.ErrorIs(t, err, ErrPermissionDenied)
				require.Zero(t, result)
				require.Equal(t, []int{0, 0, 0}, []int{links, audits, receipts})
				return
			}
			if kind == "custom conflict without entropy" {
				require.ErrorIs(t, err, ErrSlugConflict)
				require.Zero(t, result)
				require.Equal(t, []int{1, 0, 0}, []int{links, audits, receipts})
				return
			}
			require.NoError(t, err)
			require.Equal(t, len(input.Items), result.CreatedCount)
			require.Equal(t, []int{len(input.Items), len(input.Items), 1}, []int{links, audits, receipts})
			var slug string
			require.NoError(t, pool.QueryRow(t.Context(), `select slug from short_link where target_url='https://example.org/custom'`).Scan(&slug))
			require.Equal(t, "aaaaaa", slug)
			if kind == "mixed future reservation" {
				require.NoError(t, pool.QueryRow(t.Context(), `select slug from short_link where target_url='https://example.org/random'`).Scan(&slug))
				require.Equal(t, "bbbbbb", slug)
			}
		})
	}
}
