package shortlink

import (
	"bytes"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkCreateSlugFailures catches unbounded retries, reserved output and a partial commit after entropy fails.
func TestBulkCreateSlugFailures(t *testing.T) {
	for _, kind := range []string{"entropy", "reserved exhaustion", "collision exhaustion", "collision recovery"} {
		t.Run(kind, func(t *testing.T) {
			pool := testdb.ProjectMigratedPool(t.Context(), t)
			_, err := pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values
                ('00000000-0000-0000-0000-000000003851','user','User','["short_link:create","domain:use_default"]',true,now(),now());
                insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at) values
                ('00000000-0000-0000-0000-000000003852','bulk-random','Random','00000000-0000-0000-0000-000000003851','active',false,now(),now());
                insert into domain(id,host,display_name,purpose,enabled,is_default,created_at,updated_at) values
                ('00000000-0000-0000-0000-000000003853','https://bulk-random.example.com','Random','short_link',true,true,now(),now());
                insert into domain_user_group(domain_id,user_group_id) values
                ('00000000-0000-0000-0000-000000003853','00000000-0000-0000-0000-000000003851');`)
			require.NoError(t, err)
			original := slugRandomReader
			t.Cleanup(func() { slugRandomReader = original })
			slugRandomReader = bytes.NewReader(make([]byte, 128))
			baseLinks := 0
			if kind == "entropy" {
				slugRandomReader = slugErrReader{}
			}
			if kind == "reserved exhaustion" {
				_, existed := reservedSlugs["aaaaaa"]
				reservedSlugs["aaaaaa"] = struct{}{}
				t.Cleanup(func() {
					if !existed {
						delete(reservedSlugs, "aaaaaa")
					}
				})
			}
			if kind == "collision exhaustion" || kind == "collision recovery" {
				_, err = pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) values(gen_random_uuid(),'00000000-0000-0000-0000-000000003852','00000000-0000-0000-0000-000000003853','aaaaaa','https://example.com/existing','active',now(),now())`)
				require.NoError(t, err)
				baseLinks = 1
			}
			if kind == "collision recovery" {
				slugRandomReader = bytes.NewReader(append(make([]byte, 6), bytes.Repeat([]byte{1}, 128)...))
			}
			actor := auth.CurrentUser{ID: "00000000-0000-0000-0000-000000003852", GroupKey: "user"}
			result, err := NewService(pool, permission.NewDatabaseService(pool)).BatchCreate(t.Context(), actor, BatchCreateInput{RequestID: uuid.NewString(), TargetURLs: []string{"https://example.org/new"}})
			wantAudits, wantReceipts := 0, 0
			if kind == "collision recovery" {
				require.NoError(t, err)
				require.Equal(t, 1, result.CreatedCount)
				baseLinks++
				wantAudits, wantReceipts = 1, 1
			} else {
				require.Zero(t, result)
				if kind == "entropy" {
					require.EqualError(t, err, "random failed")
				} else {
					require.ErrorIs(t, err, ErrSlugConflict)
				}
			}
			var links, audits, receipts int
			require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			require.Equal(t, []int{baseLinks, wantAudits, wantReceipts}, []int{links, audits, receipts})
		})
	}
}
