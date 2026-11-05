package shortlink

import (
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestBatchTagRenameTransform catches destructive replacement and moving an already present destination.
func TestBatchTagRenameTransform(t *testing.T) {
	for _, tc := range []struct {
		name         string
		before, want []string
	}{
		{"replace in place", []string{"old", "a"}, []string{"new", "a"}},
		{"destination keeps its position", []string{"old", "a", "new"}, []string{"a", "new"}},
		{"destination first", []string{"new", "a", "old"}, []string{"new", "a"}},
		{"no old", []string{"a", "new"}, []string{"a", "new"}},
		{"case sensitive", []string{"Old", "a"}, []string{"Old", "a"}},
		{"empty", []string{}, []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := append([]string{}, tc.before...)
			require.Equal(t, tc.want, renameBatchTag(tc.before, "old", "new"))
			require.Equal(t, before, tc.before)
		})
	}
}

// TestBatchTagRenameNormalization protects non-HTTP callers from lossy versions and ambiguous tags.
func TestBatchTagRenameNormalization(t *testing.T) {
	valid := BatchTagRenameInput{Items: []BatchTagItem{{ID: "10000000-0000-4000-8000-000000000001", ExpectedUpdatedAt: "2026-11-05T03:00:00.123456789Z"}}, FromTag: " old ", ToTag: " 新😀 "}
	ids, versions, from, to, err := normalizeBatchTagRename(valid)
	require.NoError(t, err)
	require.Len(t, ids, 1)
	require.Len(t, versions, 1)
	require.Equal(t, "old", from)
	require.Equal(t, "新😀", to)
	for _, tc := range []struct {
		name, from, to string
		ok             bool
	}{
		{"32 codepoints", strings.Repeat("😀", 32), "new", true},
		{"33 codepoints", strings.Repeat("😀", 33), "new", false},
		{"raw leading tab", "\told", "new", false},
		{"raw trailing newline", "old", "new\n", false},
		{"embedded control", "old\u0085", "new", false},
		{"BOM retained", "\ufeffold", "old", true},
		{"Go unicode whitespace", "\u2003old\u00a0", "new", true},
		{"same trimmed", " old", "old ", false},
		{"case distinct", "old", "Old", true},
		{"empty", " ", "new", false},
		{"invalid UTF8", string([]byte{0xff}), "new", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := valid
			in.FromTag = tc.from
			in.ToTag = tc.to
			_, _, _, _, err := normalizeBatchTagRename(in)
			if tc.ok {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, ErrInvalidInput)
			}
		})
	}
	for _, version := range []string{"0000-01-01T00:00:00Z", "0001-01-01T00:00:00Z", "9999-12-31T23:59:59-01:00", "2026-11-05T03:00:00.1234567890Z", "2026-11-05t03:00:00Z"} {
		t.Run(version, func(t *testing.T) {
			in := valid
			in.Items = []BatchTagItem{{ID: valid.Items[0].ID, ExpectedUpdatedAt: version}}
			_, _, _, _, err := normalizeBatchTagRename(in)
			require.ErrorIs(t, err, ErrInvalidInput)
		})
	}
	for _, count := range []int{0, 1, 100, 101} {
		t.Run(fmt.Sprintf("items%d", count), func(t *testing.T) {
			in := valid
			in.Items = make([]BatchTagItem, count)
			for i := range in.Items {
				in.Items[i] = BatchTagItem{ID: fmt.Sprintf("10000000-0000-4000-8000-%012d", i+1), ExpectedUpdatedAt: valid.Items[0].ExpectedUpdatedAt}
			}
			_, _, _, _, err := normalizeBatchTagRename(in)
			if count == 1 || count == 100 {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, ErrInvalidInput)
			}
		})
	}
	in := valid
	in.Items = append(append([]BatchTagItem{}, valid.Items...), valid.Items...)
	_, _, _, _, err = normalizeBatchTagRename(in)
	require.ErrorIs(t, err, ErrInvalidInput)
}
