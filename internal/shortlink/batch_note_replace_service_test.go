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

func batchNoteReplaceFixture(t *testing.T) (*pgxpool.Pool, *shortlink.Service, auth.CurrentUser, auth.CurrentUser, shortlink.BatchNoteReplacePreviewInput) {
	t.Helper()
	pool, service, admin, owner, selected := batchNoteFixture(t)
	_, err := pool.Exec(t.Context(), `update short_link set note='new' where id=$1`, selected.Items[1].ID)
	require.NoError(t, err)
	return pool, service, admin, owner, shortlink.BatchNoteReplacePreviewInput{Items: selected.Items, Note: "new"}
}

func batchNoteReplaceInput(p shortlink.BatchNoteReplacePreviewResult, note string) shortlink.BatchNoteReplaceInput {
	input := shortlink.BatchNoteReplaceInput{Note: note}
	for _, item := range p.Items {
		input.Items = append(input.Items, shortlink.BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt, ExpectedNoteUpdatedAt: item.ExpectedNoteUpdatedAt})
	}
	return input
}

// TestBatchNoteReplaceAtomicVersions checks all fields and audits, including stale same-value replacements.
func TestBatchNoteReplaceAtomicVersions(t *testing.T) {
	pool, service, admin, owner, input := batchNoteReplaceFixture(t)
	before := batchTagsSnapshot(t, pool)
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
	require.Equal(t, 2, p.ChangedCount)
	require.Equal(t, 1, p.UnchangedCount)
	for i, item := range p.Items {
		require.Equal(t, i != 1, item.WillChange)
	}
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	for _, index := range []int{1, 2} {
		for _, noteVersion := range []bool{false, true} {
			bad := batchNoteReplaceInput(p, input.Note)
			if noteVersion {
				bad.Items[index].ExpectedNoteUpdatedAt = "2026-01-01T00:00:00Z"
			} else {
				bad.Items[index].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
			}
			r, err := service.ReplaceOwnNotes(t.Context(), owner, bad)
			require.ErrorIs(t, err, shortlink.ErrTransferConflict)
			require.Zero(t, r)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
		}
	}
	var stableBefore, stableAfter string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(l)-'note'-'note_updated_at' order by id)::text from short_link l`).Scan(&stableBefore))
	r, err := service.ReplaceOwnNotes(t.Context(), owner, batchNoteReplaceInput(p, " \r\nnew\t "))
	require.NoError(t, err)
	require.Equal(t, shortlink.BatchNoteClearResult{ChangedCount: 2, UnchangedCount: 1}, r)
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(l)-'note'-'note_updated_at' order by id)::text from short_link l`).Scan(&stableAfter))
	require.JSONEq(t, stableBefore, stableAfter)
	for i, item := range p.Items {
		var note string
		var version time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select note,note_updated_at from short_link where id=$1`, item.ID).Scan(&note, &version))
		require.Equal(t, "new", note)
		old, err := time.Parse(time.RFC3339Nano, item.ExpectedNoteUpdatedAt)
		require.NoError(t, err)
		if i == 1 {
			require.True(t, version.Equal(old))
		} else {
			require.True(t, version.After(old))
		}
	}
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from audit_log where actor_id=$1 and changed_fields=array['note']`, owner.ID).Scan(&count))
	require.Equal(t, 2, count)
	var audit string
	require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_agg(to_jsonb(a))::text from audit_log a`).Scan(&audit))
	require.NotContains(t, audit, "private-canary")
	require.NotContains(t, audit, `"new"`)
	_, err = service.ReplaceAdminNotes(t.Context(), admin, batchNoteReplaceInput(p, "new"))
	require.ErrorIs(t, err, shortlink.ErrTransferConflict)
	p, err = service.PreviewAdminNoteReplace(t.Context(), admin, input)
	require.NoError(t, err)
	require.Zero(t, p.ChangedCount)
	require.Equal(t, 3, p.UnchangedCount)
	after := batchTagsSnapshot(t, pool)
	for range 2 {
		r, err = service.ReplaceAdminNotes(t.Context(), admin, batchNoteReplaceInput(p, "new"))
		require.NoError(t, err)
		require.Equal(t, shortlink.BatchNoteClearResult{UnchangedCount: 3}, r)
	}
	require.JSONEq(t, after, batchTagsSnapshot(t, pool))
}

func TestBatchNoteReplaceVisibilityPrecedesConflict(t *testing.T) {
	pool, service, admin, owner, input := batchNoteReplaceFixture(t)
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
	for _, change := range []string{"missing", "foreign", "deleted"} {
		for _, reverse := range []bool{false, true} {
			write := batchNoteReplaceInput(p, "new")
			write.Items[0].ExpectedUpdatedAt = "2026-01-01T00:00:00Z"
			switch change {
			case "missing":
				write.Items[1].ID = uuid.NewString()
			case "foreign":
				_, err = pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, write.Items[1].ID, admin.ID)
			case "deleted":
				_, err = pool.Exec(t.Context(), `update short_link set deleted_at=now() where id=$1`, write.Items[1].ID)
			}
			require.NoError(t, err)
			if reverse {
				write.Items[0], write.Items[1] = write.Items[1], write.Items[0]
			}
			before := batchTagsSnapshot(t, pool)
			r, err := service.ReplaceOwnNotes(t.Context(), owner, write)
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			require.Zero(t, r)
			preview := shortlink.BatchNoteReplacePreviewInput{Note: "new"}
			for _, item := range write.Items {
				preview.Items = append(preview.Items, shortlink.BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt})
			}
			pr, err := service.PreviewOwnNoteReplace(t.Context(), owner, preview)
			require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
			require.Zero(t, pr)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			_, err = pool.Exec(t.Context(), `update short_link set owner_id=$1,deleted_at=null`, owner.ID)
			require.NoError(t, err)
		}
	}
}

func TestBatchNoteReplaceLosslessVersions(t *testing.T) {
	pool, service, admin, owner, input := batchNoteReplaceFixture(t)
	_, err := pool.Exec(t.Context(), `update short_link set updated_at='2026-11-05T06:00:00.123456Z',note_updated_at='2026-11-05T06:00:00.654321Z'`)
	require.NoError(t, err)
	for i := range input.Items {
		input.Items[i].ExpectedUpdatedAt = "2026-11-05T14:00:00.123456000+08:00"
	}
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	for _, field := range []string{"main", "note"} {
		write := batchNoteReplaceInput(p, "new")
		if field == "main" {
			write.Items[2].ExpectedUpdatedAt = "2026-11-05T06:00:00.123456001Z"
		} else {
			write.Items[2].ExpectedNoteUpdatedAt = "2026-11-05T06:00:00.654321001Z"
		}
		_, err = service.ReplaceAdminNotes(t.Context(), admin, write)
		require.ErrorIs(t, err, shortlink.ErrTransferConflict)
		require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	}
	write := batchNoteReplaceInput(p, "new")
	for i := range write.Items {
		write.Items[i].ExpectedUpdatedAt = input.Items[i].ExpectedUpdatedAt
		write.Items[i].ExpectedNoteUpdatedAt = "2026-11-05T14:00:00.654321000+08:00"
	}
	r, err := service.ReplaceOwnNotes(t.Context(), owner, write)
	require.NoError(t, err)
	require.Equal(t, 2, r.ChangedCount)
}

func TestBatchNoteReplaceAuditRollback(t *testing.T) {
	pool, service, _, owner, input := batchNoteReplaceFixture(t)
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
	var rejectedID string
	require.NoError(t, pool.QueryRow(t.Context(), `select id::text from short_link where note<>'new' order by id desc limit 1`).Scan(&rejectedID))
	_, err = pool.Exec(t.Context(), fmt.Sprintf(`alter table audit_log add constraint reject_batch_replace_audit check(resource_id <> '%s') not valid`, uuid.MustParse(rejectedID)))
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_, err := pool.Exec(ctx, `alter table audit_log drop constraint reject_batch_replace_audit`)
		require.NoError(t, err)
	})
	before := batchTagsSnapshot(t, pool)
	r, err := service.ReplaceOwnNotes(t.Context(), owner, batchNoteReplaceInput(p, "new"))
	var dbError *pgconn.PgError
	require.ErrorAs(t, err, &dbError)
	require.Equal(t, "23514", dbError.Code)
	require.Equal(t, "reject_batch_replace_audit", dbError.ConstraintName)
	require.Zero(t, r)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
}

// Direct callers must receive the same validation as HTTP callers.
func TestBatchNoteReplaceServiceAdmission(t *testing.T) {
	pool, service, admin, owner, input := batchNoteReplaceFixture(t)
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	for _, note := range []string{"", " \n\t", "\rx", strings.Repeat("😀", 1001), string([]byte{0xff})} {
		input.Note = note
		_, err = service.PreviewOwnNoteReplace(t.Context(), owner, input)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
		_, err = service.ReplaceAdminNotes(t.Context(), admin, batchNoteReplaceInput(p, note))
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	input.Note = "new"
	for _, actor := range []auth.CurrentUser{{}, auth.GuestUser(), func() auth.CurrentUser { a := owner; a.ID = uuid.NewString(); return a }(), func() auth.CurrentUser { a := owner; a.GroupKey = permission.GroupGuest; return a }()} {
		_, err = service.PreviewOwnNoteReplace(t.Context(), actor, input)
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
		_, err = service.ReplaceOwnNotes(t.Context(), actor, batchNoteReplaceInput(p, "new"))
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	}
	for _, bad := range []shortlink.BatchNoteReplaceInput{{Note: "new"}, {Note: "new", Items: append(batchNoteReplaceInput(p, "new").Items, pToClearItem(p.Items[0]))}, {Note: "new", Items: []shortlink.BatchNoteClearItem{{ID: p.Items[0].ID, ExpectedUpdatedAt: "bad"}}}} {
		_, err = service.ReplaceAdminNotes(t.Context(), admin, bad)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	_, err = service.PreviewAdminNoteReplace(t.Context(), admin, shortlink.BatchNoteReplacePreviewInput{Note: "new"})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
}

func pToClearItem(item shortlink.BatchNoteReplacePreviewResultItem) shortlink.BatchNoteClearItem {
	return shortlink.BatchNoteClearItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt, ExpectedNoteUpdatedAt: item.ExpectedNoteUpdatedAt}
}

func TestBatchNoteReplaceRequiredPermissions(t *testing.T) {
	pool, service, admin, owner, input := batchNoteReplaceFixture(t)
	p, err := service.PreviewOwnNoteReplace(t.Context(), owner, input)
	require.NoError(t, err)
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
			current := shortlink.NewService(pool, permission.NewService())
			if adminScope {
				_, err = current.PreviewAdminNoteReplace(t.Context(), actor, input)
			} else {
				_, err = current.PreviewOwnNoteReplace(t.Context(), actor, input)
			}
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			if adminScope {
				_, err = current.ReplaceAdminNotes(t.Context(), actor, batchNoteReplaceInput(p, "new"))
			} else {
				_, err = current.ReplaceOwnNotes(t.Context(), actor, batchNoteReplaceInput(p, "new"))
			}
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.JSONEq(t, before, batchTagsSnapshot(t, pool))
			grants := permission.UserPermissions
			if adminScope {
				grants = permission.AdminPermissions
			}
			_, err = pool.Exec(t.Context(), `update user_group set permissions=$2::jsonb where id=(select group_id from app_user where id=$1)`, actor.ID, permissionsJSON(t, grants))
			require.NoError(t, err)
		}
	}
}
