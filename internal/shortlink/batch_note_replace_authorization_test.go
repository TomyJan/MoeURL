package shortlink_test

import (
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
	"strings"
	"testing"
)

func TestBatchNoteReplaceCurrentAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
			t.Run(strings.Join([]string{map[bool]string{false: "own", true: "admin"}[adminScope], change}, "/"), func(t *testing.T) {
				pool, _, admin, owner, input := batchNoteReplaceFixture(t)
				actor := owner
				if adminScope {
					actor = admin
				}
				baseline := shortlink.NewService(pool, permission.NewService())
				p, err := baseline.PreviewAdminNoteReplace(t.Context(), admin, input)
				require.NoError(t, err)
				resolver := tagCatalogResolver{delegate: permission.NewService(), before: func() {
					var err error
					switch change {
					case "disabled":
						_, err = pool.Exec(t.Context(), `update app_user set status='disabled' where id=$1`, actor.ID)
					case "deleted":
						_, err = pool.Exec(t.Context(), `update app_user set deleted_at=now() where id=$1`, actor.ID)
					case "guest":
						_, err = pool.Exec(t.Context(), `update user_group set key='guest' where id=(select group_id from app_user where id=$1)`, actor.ID)
					case "revoked":
						_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where id=(select group_id from app_user where id=$1)`, actor.ID)
					case "moved":
						_, err = pool.Exec(t.Context(), `update app_user set group_id=(select group_id from app_user where id=$2) where id=$1`, actor.ID, map[bool]string{false: admin.ID, true: owner.ID}[adminScope])
						if !adminScope {
							_, err = pool.Exec(t.Context(), `update user_group set permissions='[]' where id=(select group_id from app_user where id=$1)`, admin.ID)
						}
					}
					require.NoError(t, err)
				}}
				service := shortlink.NewService(pool, resolver)
				before := batchTagsSnapshot(t, pool)
				if adminScope {
					_, err = service.PreviewAdminNoteReplace(t.Context(), actor, input)
				} else {
					_, err = service.PreviewOwnNoteReplace(t.Context(), actor, input)
				}
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				if adminScope {
					_, err = service.ReplaceAdminNotes(t.Context(), actor, batchNoteReplaceInput(p, "new"))
				} else {
					_, err = service.ReplaceOwnNotes(t.Context(), actor, batchNoteReplaceInput(p, "new"))
				}
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				// Actor/group setup mutations are intentional; links and audits remain unchanged.
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
	}
}

// TestBatchNoteReplaceStorageFailure never turns failed private reads/writes into an empty successful result.
func TestBatchNoteReplaceStorageFailure(t *testing.T) {
	for _, clear := range []bool{false, true} {
		for _, corruption := range []string{"actor storage", "group storage", "group JSON", "note storage", "transaction begin"} {
			t.Run(strings.Join([]string{map[bool]string{false: "preview", true: "clear"}[clear], corruption}, "/"), func(t *testing.T) {
				pool, _, admin, owner, input := batchNoteReplaceFixture(t)
				service := shortlink.NewService(pool, permission.NewService())
				p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
				require.NoError(t, err)
				switch corruption {
				case "actor storage":
					_, err = pool.Exec(t.Context(), `alter table app_user rename to inaccessible_actor`)
				case "group storage":
					_, err = pool.Exec(t.Context(), `alter table user_group rename column permissions to inaccessible_grants`)
				case "group JSON":
					_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where id=(select group_id from app_user where id=$1)`, owner.ID)
				case "note storage":
					_, err = pool.Exec(t.Context(), `alter table short_link rename column note to inaccessible_note`)
				case "transaction begin":
					pool.Close()
				}
				require.NoError(t, err)
				if clear {
					r, err := service.ReplaceOwnNotes(t.Context(), owner, batchNoteReplaceInput(p, "new"))
					require.Error(t, err)
					require.Zero(t, r)
				} else {
					r, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
					require.Error(t, err)
					require.Zero(t, r)
				}
				_ = admin
			})
		}
	}
}
