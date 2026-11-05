package shortlink

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBatchNoteReplaceFraming exercises the replacement wire format, including raw bytes and both revisions.
func TestBatchNoteReplaceFraming(t *testing.T) {
	for _, write := range []bool{false, true} {
		item := `{"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-11-05T00:00:00.123456789Z"`
		if write {
			item += `,"expectedNoteUpdatedAt":"2026-11-05T00:00:00.987654321Z"`
		}
		item += `}`
		valid := `{"items":[` + item + `],"note":"new"}`
		for _, raw := range []string{valid, `{"note":"new","items":[` + item + `]}`, strings.Repeat(" ", 65536-len(valid)) + valid} {
			items, note, err := decodeBatchNoteReplace(strings.NewReader(raw), write)
			require.NoError(t, err)
			require.Len(t, items, 1)
			require.Equal(t, "new", note)
		}
		invalid := []string{
			"", "null", "[]", "{}", `{"no`, `{"items":[],"no`, `{"items":[],"note":"new"}`, `{"items":null,"note":"new"}`,
			valid + "{}", valid + "x", valid[:len(valid)-1], valid[:len(valid)-2], valid[:len(valid)-4],
			strings.Replace(valid, `"items":`, `"items":[],"items":`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"old","note":"new"`, 1),
			strings.Replace(valid, `"note":"new"`, `"other":"new"`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"new","unknown":0`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":null`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":1`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":{}`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"\ud800"`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"\udc00"`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"`+string([]byte{0xff})+`"`, 1),
			strings.Replace(valid, `"id":`, `"id":"bad","id":`, 1),
			strings.Replace(valid, `"id":`, `"unknown":true,"id":`, 1),
			strings.Replace(valid, `"id":"af000000-0000-0000-0000-000000000001"`, `"id":null`, 1),
			strings.Replace(valid, `"expectedUpdatedAt":`, `"expectedUpdatedAt":"bad","expectedUpdatedAt":`, 1),
			strings.Replace(valid, `"items":[`+item+`]`, `"items":[`+item+`,`+item+`]`, 1),
			strings.Repeat(" ", 65537-len(valid)) + valid,
		}
		if write {
			invalid = append(invalid, strings.Replace(valid, `,"expectedNoteUpdatedAt":"2026-11-05T00:00:00.987654321Z"`, "", 1))
		} else {
			invalid = append(invalid, strings.Replace(valid, `"id":`, `"expectedNoteUpdatedAt":"2026-11-05T00:00:00Z","id":`, 1))
		}
		for i, raw := range invalid {
			t.Run(fmt.Sprintf("write=%t/invalid%d", write, i), func(t *testing.T) {
				items, note, err := decodeBatchNoteReplace(strings.NewReader(raw), write)
				require.ErrorIs(t, err, ErrInvalidInput)
				require.Nil(t, items)
				require.Empty(t, note)
			})
		}
		_, _, err := decodeBatchNoteReplace(batchNoteBrokenReader{}, write)
		require.ErrorIs(t, err, ErrInvalidInput)
		for _, count := range []int{0, 1, 100, 101} {
			items := make([]string, count)
			for i := range items {
				items[i] = strings.Replace(item, "af000000-0000-0000-0000-000000000001", uuid.NewString(), 1)
			}
			payload := `{"note":"new","items":[` + strings.Join(items, ",") + `]}`
			decoded, _, err := decodeBatchNoteReplace(strings.NewReader(payload), write)
			if count == 0 || count == 101 {
				require.ErrorIs(t, err, ErrInvalidInput)
			} else {
				require.NoError(t, err)
				require.Len(t, decoded, count)
			}
		}
	}
}

func TestBatchNoteReplaceTextCorpus(t *testing.T) {
	for _, tc := range []struct {
		name, raw, want string
		invalid         bool
	}{
		{"CRLF", " \r\nhello\r\nworld\t ", "hello\nworld", false},
		{"internal LF TAB", "one\n\ttwo", "one\n\ttwo", false},
		{"BOM preserved", "\ufeff", "\ufeff", false},
		{"Go spaces", "\u00a0\u2000\u3000x\u00a0", "x", false},
		{"NEL rejected before trim", "\u0085x\u0085", "", true},
		{"emoji1000", strings.Repeat("😀", 1000), strings.Repeat("😀", 1000), false},
		{"emoji1001", strings.Repeat("😀", 1001), "", true},
		{"blank", "\n\t\u3000 ", "", true},
		{"empty", "", "", true},
		{"bare CR", "\rx", "", true},
		{"control before trim", "\x00x", "", true},
		{"DEL", "x\x7f", "", true},
		{"C1", "x\u009f", "", true},
	} {
		for _, write := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/write=%t", tc.name, write), func(t *testing.T) {
				item := map[string]string{"id": uuid.NewString(), "expectedUpdatedAt": "2026-11-05T00:00:00Z"}
				if write {
					item["expectedNoteUpdatedAt"] = "2026-11-05T00:00:00Z"
				}
				raw, err := json.Marshal(map[string]any{"items": []any{item}, "note": tc.raw})
				require.NoError(t, err)
				_, note, err := decodeBatchNoteReplace(strings.NewReader(string(raw)), write)
				if tc.invalid {
					require.ErrorIs(t, err, ErrInvalidInput)
				} else {
					require.NoError(t, err)
					require.Equal(t, tc.want, note)
				}
			})
		}
	}
}
