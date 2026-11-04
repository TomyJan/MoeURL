package shortlink

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

type batchNoteBrokenReader struct{}

func (batchNoteBrokenReader) Read([]byte) (int, error) {
	return 0, errors.New("private-canary-reader-error")
}

// TestBatchNoteClearFraming checks the public wire contract rather than the parser's internal token sequence.
func TestBatchNoteClearFraming(t *testing.T) {
	for _, clear := range []bool{false, true} {
		item := fmt.Sprintf(`{"id":%q,"expectedUpdatedAt":"2026-11-03T00:00:00.123456Z"`, uuid.NewString())
		if clear {
			item += `,"expectedNoteUpdatedAt":"2026-11-03T00:00:00.123456789Z"`
		}
		item += "}"
		valid := `{"items":[` + item + `]}`
		for _, raw := range []string{valid, strings.Repeat(" ", 65536-len(valid)) + valid} {
			items, err := decodeBatchNoteItems(strings.NewReader(raw), clear)
			require.NoError(t, err)
			require.Len(t, items, 1)
		}
		cases := []string{"", "null", "[]", "{}", `{"items":null}`, `{"items":{}}`, `{"items":[]}`, `{"items":[null]}`, `{"items":[{}]}`, valid + "{}", valid + "x", valid[:len(valid)-1], valid[:len(valid)-2], valid[:len(valid)-3], strings.Replace(valid, `"items":`, `"other":`, 1), strings.Replace(valid, `"items":`, `"items":[],"items":`, 1), strings.Replace(valid, `"items":`, `"unknown":0,"items":`, 1), strings.Replace(valid, `"id":`, `"id":"x","id":`, 1), strings.Replace(valid, `"id":`, `"note":"canary","id":`, 1), strings.Replace(valid, `"expectedUpdatedAt":"2026-11-03T00:00:00.123456Z"`, `"expectedUpdatedAt":null`, 1), strings.Replace(valid, `"expectedUpdatedAt":"2026-11-03T00:00:00.123456Z"`, `"expectedUpdatedAt":"\ud800"`, 1), strings.Replace(valid, `"expectedUpdatedAt":"2026-11-03T00:00:00.123456Z"`, `"expectedUpdatedAt":"`+string([]byte{0xff})+`"`, 1), `{"items":[` + item + `,` + item + `]}`, strings.Repeat(" ", 65537-len(valid)) + valid}
		for i, raw := range cases {
			t.Run(fmt.Sprintf("clear=%t/invalid%d", clear, i), func(t *testing.T) {
				items, err := decodeBatchNoteItems(strings.NewReader(raw), clear)
				require.ErrorIs(t, err, ErrInvalidInput)
				require.Nil(t, items)
			})
		}
		_, err := decodeBatchNoteItems(batchNoteBrokenReader{}, clear)
		require.ErrorIs(t, err, ErrInvalidInput)
		items := make([]BatchNoteClearItem, 100)
		for i := range items {
			items[i] = BatchNoteClearItem{ID: uuid.NewString(), ExpectedUpdatedAt: "2026-11-03T00:00:00.123456Z", ExpectedNoteUpdatedAt: "2026-11-03T00:00:00.123456789Z"}
		}
		for _, count := range []int{0, 1, 100, 101} {
			values := items[:min(count, 100)]
			if count == 101 {
				values = append(append([]BatchNoteClearItem(nil), items...), BatchNoteClearItem{ID: uuid.NewString(), ExpectedUpdatedAt: items[0].ExpectedUpdatedAt, ExpectedNoteUpdatedAt: items[0].ExpectedNoteUpdatedAt})
			}
			var payload []byte
			if clear {
				payload, err = json.Marshal(BatchNoteClearInput{Items: values})
			} else {
				preview := BatchNotePreviewInput{Items: make([]BatchNotePreviewItem, len(values))}
				for i, item := range values {
					preview.Items[i] = BatchNotePreviewItem{ID: item.ID, ExpectedUpdatedAt: item.ExpectedUpdatedAt}
				}
				payload, err = json.Marshal(preview)
			}
			require.NoError(t, err)
			decoded, err := decodeBatchNoteItems(strings.NewReader(string(payload)), clear)
			if count == 0 || count == 101 {
				require.ErrorIs(t, err, ErrInvalidInput)
			} else {
				require.NoError(t, err)
				require.Len(t, decoded, count)
			}
		}
	}
}

func TestBatchNoteClearVersionCorpus(t *testing.T) {
	for _, raw := range []string{`{"items":[{"id`, `{"items":[{"id":"bad",`, `{"items":[{"id":"bad"}]} `} {
		_, err := decodeBatchNoteItems(strings.NewReader(raw), false)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
	raw, err := os.ReadFile("../../testdata/short-link-note-versions.json")
	require.NoError(t, err)
	var cases []struct {
		ID, Input string
		Valid     bool
	}
	require.NoError(t, json.Unmarshal(raw, &cases))
	for _, tc := range cases {
		for _, field := range []string{"main", "note"} {
			t.Run(field+"/"+tc.ID, func(t *testing.T) {
				item := BatchNoteClearItem{ID: uuid.NewString(), ExpectedUpdatedAt: "2026-11-03T00:00:00Z", ExpectedNoteUpdatedAt: "2026-11-03T00:00:00Z"}
				if field == "main" {
					item.ExpectedUpdatedAt = tc.Input
				} else {
					item.ExpectedNoteUpdatedAt = tc.Input
				}
				_, _, err := normalizeBatchNoteItems([]BatchNoteClearItem{item}, true)
				if tc.Valid {
					require.NoError(t, err)
				} else {
					require.ErrorIs(t, err, ErrInvalidInput)
				}
			})
		}
	}
	for _, id := range []string{"bad", uuid.Nil.String(), "AF000000-0000-0000-0000-000000000001"} {
		_, _, err := normalizeBatchNoteItems([]BatchNoteClearItem{{ID: id, ExpectedUpdatedAt: "2026-11-03T00:00:00Z"}}, false)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}
