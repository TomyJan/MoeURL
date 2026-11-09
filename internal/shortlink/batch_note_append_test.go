package shortlink

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

func TestDecodeBatchNoteAppendFraming(t *testing.T) {
	item := `"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-11-03T00:00:00.123456789Z"`
	versionedItem := item + `,"expectedNoteUpdatedAt":"2026-11-03T00:00:00.987654321Z"`
	preview := `{"items":[{` + item + `}],"note":"\r\nadded\t"}`
	write := `{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","items":[{` + versionedItem + `}],"note":"added"}`

	requestID, items, note, err := decodeBatchNoteAppend(strings.NewReader(preview), false)
	require.NoError(t, err)
	require.Empty(t, requestID)
	require.Len(t, items, 1)
	require.Equal(t, "added", note)

	requestID, items, note, err = decodeBatchNoteAppend(strings.NewReader(write), true)
	require.NoError(t, err)
	require.Equal(t, "8afed221-bffc-4a61-a93e-4f8e13cdf8d1", requestID)
	require.Len(t, items, 1)
	require.Equal(t, "added", note)
	bomWrite := strings.Replace(write, `"note":"added"`, `"note":"\ufeff"`, 1)
	_, _, note, err = decodeBatchNoteAppend(strings.NewReader(bomWrite), true)
	require.NoError(t, err)
	require.Equal(t, "\ufeff", note)
	for _, count := range []int{1000, 1001} {
		longNote, marshalErr := json.Marshal(map[string]any{"requestId": "8afed221-bffc-4a61-a93e-4f8e13cdf8d1", "items": []any{map[string]string{"id": "af000000-0000-0000-0000-000000000001", "expectedUpdatedAt": "2026-11-03T00:00:00.123456789Z", "expectedNoteUpdatedAt": "2026-11-03T00:00:00.987654321Z"}}, "note": strings.Repeat("猫", count)})
		require.NoError(t, marshalErr)
		_, _, decodedNote, decodeErr := decodeBatchNoteAppend(strings.NewReader(string(longNote)), true)
		if count == 1000 {
			require.NoError(t, decodeErr)
			require.Equal(t, 1000, utf8.RuneCountInString(decodedNote))
		} else {
			require.ErrorIs(t, decodeErr, ErrInvalidInput)
		}
	}

	for _, tc := range []struct {
		name string
		body string
	}{
		{"duplicate outer key", strings.Replace(write, `,"note":"added"`, `,"note":"added","note":"again"`, 1)},
		{"unknown field", strings.Replace(write, `,"note":"added"`, `,"scope":"admin","note":"added"`, 1)},
		{"null request id", strings.Replace(write, `"8afed221-bffc-4a61-a93e-4f8e13cdf8d1"`, `null`, 1)},
		{"zero request id", strings.Replace(write, `"8afed221-bffc-4a61-a93e-4f8e13cdf8d1"`, `"00000000-0000-0000-0000-000000000000"`, 1)},
		{"duplicate nested id", strings.Replace(write, `,"expectedUpdatedAt"`, `,"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt"`, 1)},
		{"unpaired surrogate", strings.Replace(write, `"note":"added"`, `"note":"\ud800"`, 1)},
		{"control character", strings.Replace(write, `"note":"added"`, `"note":"\u0000"`, 1)},
		{"trailing value", write + ` {}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, gotItems, gotNote, err := decodeBatchNoteAppend(strings.NewReader(tc.body), true)
			require.ErrorIs(t, err, ErrInvalidInput)
			require.Nil(t, gotItems)
			require.Empty(t, gotNote)
		})
	}
	for _, tc := range []struct {
		name string
		body string
	}{
		{"exact limit", strings.Repeat(" ", 65536-len(write)) + write},
		{"over limit", strings.Repeat(" ", 65537-len(write)) + write},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, _, _, err := decodeBatchNoteAppend(strings.NewReader(tc.body), true)
			if tc.name == "exact limit" {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, ErrInvalidInput)
			}
		})
	}
}

// TestBatchNoteAppendStrictCorpus rejects ambiguous payloads before private storage is accessed.
func TestBatchNoteAppendStrictCorpus(t *testing.T) {
	for _, write := range []bool{false, true} {
		item := `{"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-11-05T00:00:00.123456789Z"`
		if write {
			item += `,"expectedNoteUpdatedAt":"2026-11-05T00:00:00.987654321Z"`
		}
		item += "}"
		prefix := "{"
		if write {
			prefix += `"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1",`
		}
		valid := prefix + `"items":[` + item + `],"note":"new"}`
		for _, raw := range []string{valid, strings.Repeat(" ", 65536-len(valid)) + valid} {
			_, items, note, err := decodeBatchNoteAppend(strings.NewReader(raw), write)
			require.NoError(t, err)
			require.Len(t, items, 1)
			require.Equal(t, "new", note)
		}
		invalid := []string{
			"", "null", "[]", "{}", `{"no`, `{"items":[],"no`,
			valid + "{}", valid + "x", valid[:len(valid)-1], valid[:len(valid)-2], valid[:len(valid)-4],
			strings.Replace(valid, `"items":`, `"items":null,"items":`, 1),
			strings.Replace(valid, `"items":[`+item+`]`, `"items":[]`, 1),
			strings.Replace(valid, `"items":[`+item+`]`, `"items":null`, 1),
			strings.Replace(valid, `"items":[`+item+`]`, `"items":[`+item+","+item+`]`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":null`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":1`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":{}`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":""`, 1),
			strings.Replace(valid, `"note":"new"`, `"note":"`+string([]byte{0xff})+`"`, 1),
			strings.Replace(valid, `"id":`, `"id":"bad","id":`, 1),
			strings.Replace(valid, `"id":`, `"unknown":true,"id":`, 1),
			strings.Replace(valid, `"expectedUpdatedAt":`, `"expectedUpdatedAt":"bad","expectedUpdatedAt":`, 1),
		}
		if write {
			invalid = append(invalid, strings.Replace(valid, `"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1"`, `"requestId":"bad"`, 1))
		} else {
			invalid = append(invalid, strings.Replace(valid, `"id":`, `"expectedNoteUpdatedAt":"2026-11-05T00:00:00Z","id":`, 1))
		}
		for i, raw := range invalid {
			t.Run(fmt.Sprintf("write=%t/invalid%d", write, i), func(t *testing.T) {
				requestID, items, note, err := decodeBatchNoteAppend(strings.NewReader(raw), write)
				require.ErrorIs(t, err, ErrInvalidInput)
				require.Empty(t, requestID)
				require.Nil(t, items)
				require.Empty(t, note)
			})
		}
		_, _, _, err := decodeBatchNoteAppend(batchNoteBrokenReader{}, write)
		require.ErrorIs(t, err, ErrInvalidInput)
		for _, count := range []int{0, 1, 100, 101} {
			items := make([]string, count)
			for i := range items {
				items[i] = strings.Replace(item, "af000000-0000-0000-0000-000000000001", uuid.NewString(), 1)
			}
			payload := prefix + `"items":[` + strings.Join(items, ",") + `],"note":"new"}`
			_, decoded, _, err := decodeBatchNoteAppend(strings.NewReader(payload), write)
			if count == 0 || count == 101 {
				require.ErrorIs(t, err, ErrInvalidInput)
			} else {
				require.NoError(t, err)
				require.Len(t, decoded, count)
			}
		}
	}
}
