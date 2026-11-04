package shortlink_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
)

func batchNoteFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, shortlink.BatchNotePreviewInput) {
	t.Helper()
	pool, service, admin, owner, _, note := noteFixture(t)
	ids := []string{note.ID, insertStoredShortLink(t, t.Context(), pool, owner.ID, "batchnote2", "https://example.com/two", "active", false), insertStoredShortLink(t, t.Context(), pool, owner.ID, "batchnote3", "https://example.com/three", "active", false)}
	_, err := pool.Exec(t.Context(), `update short_link set note=case when id=$1 then 'private-canary-猫😀' when id=$2 then chr(65279) else '' end`, ids[0], ids[1])
	require.NoError(t, err)
	input := shortlink.BatchNotePreviewInput{}
	for _, id := range ids {
		var updated time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, id).Scan(&updated))
		input.Items = append(input.Items, shortlink.BatchNotePreviewItem{ID: id, ExpectedUpdatedAt: updated.UTC().Format(time.RFC3339Nano)})
	}
	return pool, service, admin, owner, input
}

func batchNoteClearInput(p shortlink.BatchNotePreviewResult) shortlink.BatchNoteClearInput {
	input := shortlink.BatchNoteClearInput{}
	for _, item := range p.Items {
		input.Items = append(input.Items, shortlink.BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt, ExpectedNoteUpdatedAt: item.ExpectedNoteUpdatedAt})
	}
	return input
}

// TestBatchNoteClearAtomicVersions detects partial writes, broad field changes, leaked content and stale no-ops.
func TestBatchNoteClearAtomicVersions(t *testing.T) {
	pool, service, admin, owner, input := batchNoteFixture(t)
	before := batchTagsSnapshot(t, pool)
	preview, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, 2, preview.NonemptyCount)
	require.Equal(t, 1, preview.EmptyCount)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	clear := batchNoteClearInput(preview)
	for _, noteVersion := range []bool{false, true} {
		bad := shortlink.BatchNoteClearInput{Items: append([]shortlink.BatchNoteClearItem(nil), clear.Items...)}
		if noteVersion {
			bad.Items[2].ExpectedNoteUpdatedAt = "2026-01-01T00:00:00Z"
		} else {
			bad.Items[2].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
		}
		_, err = service.ClearOwnNotes(t.Context(), owner, bad)
		require.ErrorIs(t, err, shortlink.ErrTransferConflict)
		require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	}
	var stableBefore string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(l)-'note'-'note_updated_at' order by id)::text from short_link l`).Scan(&stableBefore))
	result, err := service.ClearOwnNotes(t.Context(), owner, clear)
	require.NoError(t, err)
	require.Equal(t, shortlink.BatchNoteClearResult{ChangedCount: 2, UnchangedCount: 1}, result)
	var stableAfter string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(l)-'note'-'note_updated_at' order by id)::text from short_link l`).Scan(&stableAfter))
	require.JSONEq(t, stableBefore, stableAfter)
	for i, item := range clear.Items {
		var note string
		var version time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select note,note_updated_at from short_link where id=$1`, item.ID).Scan(&note, &version))
		require.Empty(t, note)
		old, err := time.Parse(time.RFC3339Nano, item.ExpectedNoteUpdatedAt)
		require.NoError(t, err)
		if i == 2 {
			require.True(t, version.Equal(old))
		} else {
			require.True(t, version.After(old))
		}
	}
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&count))
	require.Equal(t, 2, count)
	_, err = service.ClearAdminNotes(t.Context(), admin, clear)
	require.ErrorIs(t, err, shortlink.ErrTransferConflict)
	p, err := service.PreviewAdminNoteClear(t.Context(), admin, input)
	require.NoError(t, err)
	require.Zero(t, p.NonemptyCount)
	require.Equal(t, 3, p.EmptyCount)
	after := batchTagsSnapshot(t, pool)
	for range 2 {
		result, err = service.ClearAdminNotes(t.Context(), admin, batchNoteClearInput(p))
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchNoteClearResult{UnchangedCount: 3}, result)
	}
	require.JSONEq(t, after, batchTagsSnapshot(t, pool))
}

func TestBatchNoteClearMissingBeforeConflict(t *testing.T) {
	pool, service, admin, owner, input := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
	require.NoError(t, err)
	for _, change := range []string{"missing", "foreign", "deleted"} {
		for _, reverse := range []bool{false, true} {
			clear := batchNoteClearInput(p)
			clear.Items[0].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
			switch change {
			case "missing":
				clear.Items[1].ID = uuid.NewString()
			case "foreign":
				_, err = pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, clear.Items[1].ID, admin.ID)
			case "deleted":
				_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, clear.Items[1].ID)
			}
			require.NoError(t, err)
			if reverse {
				clear.Items[0], clear.Items[1] = clear.Items[1], clear.Items[0]
			}
			before := batchTagsSnapshot(t, pool)
			_, err = service.ClearOwnNotes(t.Context(), owner, clear)
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			previewInput := shortlink.BatchNotePreviewInput{}
			for _, item := range clear.Items {
				previewInput.Items = append(previewInput.Items, shortlink.BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt})
			}
			_, err = service.PreviewOwnNoteClear(t.Context(), owner, previewInput)
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			_, err = pool.Exec(t.Context(), `update short_link set owner_id=$1,deleted_at=null`, owner.ID)
			require.NoError(t, err)
		}
	}
}

func TestBatchNoteClearAuditRollback(t *testing.T) {
	pool, service, _, owner, input := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
	require.NoError(t, err)
	var rejectedID string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from short_link where note<>'' order by id desc limit 1`).Scan(&rejectedID))
	// The first nonempty row and its audit are accepted; only the second audit fails.
	_, err = pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_batch_note_audit check(resource_id <> '%s') not valid`, uuid.MustParse(rejectedID)))
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := pool.Exec(ctx, `alter table audit_log drop constraint reject_batch_note_audit`)
		require.NoError(t, err)
	})
	before := batchTagsSnapshot(t, pool)
	result, err := service.ClearOwnNotes(t.Context(), owner, batchNoteClearInput(p))
	require.Error(t, err)
	var databaseError *pgconn.PgError
	require.ErrorAs(t, err, &databaseError)
	require.Equal(t, "23514", databaseError.Code)
	require.Equal(t, "reject_batch_note_audit", databaseError.ConstraintName)
	require.Zero(t, result)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
}

func TestBatchNoteClearCurrentAuthorization(t *testing.T) {
	for _, adminScope := range []bool{false, true} {
		for _, change := range []string{"disabled", "deleted", "guest", "revoked", "moved"} {
			t.Run(strings.Join([]string{map[bool]string{false: "own", true: "admin"}[adminScope], change}, "/"), func(t *testing.T) {
				pool, _, admin, owner, input := batchNoteFixture(t)
				actor := owner
				if adminScope {
					actor = admin
				}
				baseline := shortlink.NewService(pool, permission.NewService())
				p, err := baseline.PreviewAdminNoteClear(t.Context(), admin, input)
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
					_, err = service.PreviewAdminNoteClear(t.Context(), actor, input)
				} else {
					_, err = service.PreviewOwnNoteClear(t.Context(), actor, input)
				}
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				if adminScope {
					_, err = service.ClearAdminNotes(t.Context(), actor, batchNoteClearInput(p))
				} else {
					_, err = service.ClearOwnNotes(t.Context(), actor, batchNoteClearInput(p))
				}
				require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				// Actor/group setup mutations are intentional; links and audits remain unchanged.
				require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			})
		}
	}
}

// TestBatchNoteClearLosslessVersions rejects a one-nanosecond mismatch without accepting database truncation.
func TestBatchNoteClearLosslessVersions(t *testing.T) {
	pool, service, admin, owner, input := batchNoteFixture(t)
	_, err := pool.Exec(t.Context(), `update short_link set updated_at='2026-11-04T06:00:00.123456Z',note_updated_at='2026-11-04T06:00:00.654321Z'`)
	require.NoError(t, err)
	for i := range input.Items {
		input.Items[i].ExpectedUpdatedAt = "2026-11-04T14:00:00.123456000+08:00"
	}
	p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	for _, field := range []string{"main", "note"} {
		clear := batchNoteClearInput(p)
		if field == "main" {
			clear.Items[2].ExpectedUpdatedAt = "2026-11-04T06:00:00.123456001Z"
		} else {
			clear.Items[2].ExpectedNoteUpdatedAt = "2026-11-04T06:00:00.654321001Z"
		}
		_, err = service.ClearAdminNotes(t.Context(), admin, clear)
		require.ErrorIs(t, err, shortlink.ErrTransferConflict)
		require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	}
	clear := batchNoteClearInput(p)
	for i := range clear.Items {
		clear.Items[i].ExpectedUpdatedAt = input.Items[i].ExpectedUpdatedAt
		clear.Items[i].ExpectedNoteUpdatedAt = "2026-11-04T14:00:00.654321000+08:00"
	}
	r, err := service.ClearOwnNotes(t.Context(), owner, clear)
	require.NoError(t, err)
	require.Equal(t, 2, r.ChangedCount)
}

// TestBatchNoteClearServiceAdmission protects callers that bypass HTTP and stale/missing actor snapshots.
func TestBatchNoteClearServiceAdmission(t *testing.T) {
	pool, service, admin, owner, input := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
	require.NoError(t, err)
	clear := batchNoteClearInput(p)
	for _, actor := range []auth.CurrentUser{{}, auth.GuestUser(), func() auth.CurrentUser { a := owner; a.ID = uuid.NewString(); return a }(), func() auth.CurrentUser { a := owner; a.GroupKey = permission.GroupGuest; return a }()} {
		s := shortlink.NewService(pool, permission.NewService())
		_, err = s.PreviewOwnNoteClear(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = s.ClearOwnNotes(t.Context(), actor, clear)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	for _, bad := range []shortlink.BatchNoteClearInput{{}, {Items: append(clear.Items, clear.Items[0])}, {Items: []shortlink.BatchNoteClearItem{{ID: clear.Items[0].ID, ExpectedUpdatedAt: "bad", ExpectedNoteUpdatedAt: clear.Items[0].ExpectedNoteUpdatedAt}}}, {Items: []shortlink.BatchNoteClearItem{{ID: clear.Items[0].ID, ExpectedUpdatedAt: clear.Items[0].ExpectedUpdatedAt}}}} {
		_, err = service.ClearAdminNotes(t.Context(), admin, bad)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	_, err = service.PreviewAdminNoteClear(t.Context(), admin, shortlink.BatchNotePreviewInput{})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	for _, adminScope := range []bool{false, true} {
		actor := owner
		required := []string{permission.ShortLinkReadOwn, permission.ShortLinkUpdateOwn, permission.ShortLinkSetMetadata}
		if adminScope {
			actor = admin
			required = []string{permission.AdminAccess, permission.ShortLinkReadAll, permission.ShortLinkUpdateAll, permission.ShortLinkSetMetadata}
		}
		for _, capability := range required {
			before := batchTagsSnapshot(t, pool)
			_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-$2::text where id=(select group_id from app_user where id=$1)`, actor.ID, capability)
			require.NoError(t, err)
			s := shortlink.NewService(pool, permission.NewService())
			if adminScope {
				_, err = s.PreviewAdminNoteClear(t.Context(), actor, input)
			} else {
				_, err = s.PreviewOwnNoteClear(t.Context(), actor, input)
			}
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			if adminScope {
				_, err = s.ClearAdminNotes(t.Context(), actor, clear)
			} else {
				_, err = s.ClearOwnNotes(t.Context(), actor, clear)
			}
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			permissions := permission.UserPermissions
			if adminScope {
				permissions = permission.AdminPermissions
			}
			_, err = pool.Exec(t.Context(), `update user_group set permissions=$2::jsonb where id=(select group_id from app_user where id=$1)`, actor.ID, permissionsJSON(t, permissions))
			require.NoError(t, err)
		}
	}
}

// TestBatchNoteClearStorageFailure never turns failed private reads/writes into an empty successful result.
func TestBatchNoteClearStorageFailure(t *testing.T) {
	for _, clear := range []bool{false, true} {
		for _, corruption := range []string{"actor storage", "group storage", "group JSON", "note storage", "transaction begin"} {
			t.Run(strings.Join([]string{map[bool]string{false: "preview", true: "clear"}[clear], corruption}, "/"), func(t *testing.T) {
				pool, _, admin, owner, input := batchNoteFixture(t)
				service := shortlink.NewService(pool, permission.NewService())
				p, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
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
					r, err := service.ClearOwnNotes(t.Context(), owner, batchNoteClearInput(p))
					require.Error(t, err)
					require.Zero(t, r)
				} else {
					r, err := service.PreviewOwnNoteClear(t.Context(), owner, input)
					require.Error(t, err)
					require.Zero(t, r)
				}
				_ = admin
			})
		}
	}
}
