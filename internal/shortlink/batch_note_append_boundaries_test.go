package shortlink_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteAppendServiceRejectsInvalidInputs protects non-HTTP callers and does not leave receipts on failure.
func TestBatchNoteAppendServiceRejectsInvalidInputs(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "new"})
	require.NoError(t, err)
	before := batchTagsSnapshot(t, pool)
	_, err = service.AppendOwnNotes(t.Context(), auth.CurrentUser{}, batchNoteAppendInput(p, "new", uuid.NewString()))
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	for _, note := range []string{"", " ", strings.Repeat("x", 1001), string([]byte{0}), string([]byte{0xff})} {
		_, err = service.AppendOwnNotes(t.Context(), owner, batchNoteAppendInput(p, note, uuid.NewString()))
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	invalid := []shortlink.BatchNoteAppendInput{
		{RequestID: uuid.NewString(), Note: "new"},
		{RequestID: uuid.NewString(), Note: "new", Items: []shortlink.BatchNoteClearItem{{ID: "bad", ExpectedUpdatedAt: p.Items[0].ExpectedUpdatedAt, ExpectedNoteUpdatedAt: p.Items[0].ExpectedNoteUpdatedAt}}},
		batchNoteAppendInput(p, "new", "bad"),
	}
	for _, input := range invalid {
		_, err = service.AppendOwnNotes(t.Context(), owner, input)
		require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	}
	_, err = service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	_, err = service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Note: "new"})
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	guest := owner
	guest.GroupKey = "guest"
	_, err = service.AppendOwnNotes(t.Context(), guest, batchNoteAppendInput(p, "new", uuid.NewString()))
	require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	var receipts int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch`).Scan(&receipts))
	require.Zero(t, receipts)
}

// TestBatchNoteAppendStorageErrors cannot acknowledge an empty successful operation after storage fails.
func TestBatchNoteAppendStorageErrors(t *testing.T) {
	for _, write := range []bool{false, true} {
		for _, failure := range []string{"actor missing", "actor storage", "group storage", "group JSON", "note storage", "receipt storage", "begin"} {
			if !write && failure == "receipt storage" {
				continue
			}
			t.Run(map[bool]string{false: "preview", true: "write"}[write]+"/"+failure, func(t *testing.T) {
				pool, service, _, owner, selected := batchNoteFixture(t)
				p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "new"})
				require.NoError(t, err)
				input := batchNoteAppendInput(p, "new", uuid.NewString())
				current := shortlink.NewService(pool, permission.NewService())
				switch failure {
				case "actor missing":
					owner.ID = uuid.NewString()
				case "actor storage":
					_, err = pool.Exec(t.Context(), `alter table app_user rename to unavailable_actor`)
				case "group storage":
					_, err = pool.Exec(t.Context(), `alter table user_group rename column permissions to unavailable_permissions`)
				case "group JSON":
					_, err = pool.Exec(t.Context(), `update user_group set permissions='{}' where id=(select group_id from app_user where id=$1)`, owner.ID)
				case "note storage":
					_, err = pool.Exec(t.Context(), `alter table short_link rename column note to unavailable_note`)
				case "receipt storage":
					_, err = pool.Exec(t.Context(), `alter table short_link_note_append_batch rename to unavailable_receipt`)
				case "begin":
					pool.Close()
				}
				require.NoError(t, err)
				if write {
					result, err := current.AppendOwnNotes(t.Context(), owner, input)
					require.Error(t, err)
					require.Zero(t, result)
				} else {
					result, err := current.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "new"})
					require.Error(t, err)
					require.Zero(t, result)
				}
			})
		}
	}
}

// TestBatchNoteAppendOverflowAndInvisibleTarget proves full-set validation precedes all writes.
func TestBatchNoteAppendOverflowAndInvisibleTarget(t *testing.T) {
	pool, service, admin, owner, selected := batchNoteFixture(t)
	_, err := pool.Exec(t.Context(), `update short_link set note=$2 where id=$1`, selected.Items[2].ID, strings.Repeat("😀", 998))
	require.NoError(t, err)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "xy"})
	require.NoError(t, err)
	require.Equal(t, 2, p.AppendableCount)
	require.Equal(t, 1, p.OverflowCount)
	before := batchTagsSnapshot(t, pool)
	_, err = service.AppendOwnNotes(t.Context(), owner, batchNoteAppendInput(p, "xy", uuid.NewString()))
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	_, err = pool.Exec(t.Context(), `update short_link set owner_id=$2 where id=$1`, selected.Items[1].ID, admin.ID)
	require.NoError(t, err)
	before = batchTagsSnapshot(t, pool)
	_, err = service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "xy"})
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	_, err = service.AppendOwnNotes(t.Context(), owner, batchNoteAppendInput(p, "xy", uuid.NewString()))
	require.ErrorIs(t, err, shortlink.ErrShortLinkMissing)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
}

// TestBatchNoteAppendHundredthTargetOverflow ensures that validating the last selected item cannot leave the first 99 partially appended.
func TestBatchNoteAppendHundredthTargetOverflow(t *testing.T) {
	pool, service, _, owner, selected := batchNoteFixture(t)
	for i := len(selected.Items); i < 100; i++ {
		id := insertStoredShortLink(t, t.Context(), pool, owner.ID, fmt.Sprintf("appendlimit%d", i), "https://example.com", "active", false)
		var main time.Time
		require.NoError(t, pool.QueryRow(t.Context(), `select updated_at from short_link where id=$1`, id).Scan(&main))
		selected.Items = append(selected.Items, shortlink.BatchNotePreviewItem{ID: id, ExpectedUpdatedAt: main.UTC().Format(time.RFC3339Nano)})
	}
	_, err := pool.Exec(t.Context(), `update short_link set note=$2 where id=$1`, selected.Items[99].ID, strings.Repeat("猫", 1000))
	require.NoError(t, err)
	p, err := service.PreviewOwnNoteAppend(t.Context(), owner, shortlink.BatchNoteAppendPreviewInput{Items: selected.Items, Note: "x"})
	require.NoError(t, err)
	require.Equal(t, 99, p.AppendableCount)
	require.Equal(t, 1, p.OverflowCount)
	before := batchTagsSnapshot(t, pool)
	_, err = service.AppendOwnNotes(t.Context(), owner, batchNoteAppendInput(p, "x", uuid.NewString()))
	require.ErrorIs(t, err, shortlink.ErrInvalidInput)
	require.JSONEq(t, before, batchTagsSnapshot(t, pool))
	var count int
	require.NoError(t, pool.QueryRow(t.Context(), `select count(*) from short_link_note_append_batch`).Scan(&count))
	require.Zero(t, count)
}
