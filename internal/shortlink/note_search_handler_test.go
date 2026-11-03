package shortlink

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

type noteSearchFake struct{ err error }

func (s noteSearchFake) SearchOwnNotes(context.Context, auth.CurrentUser, NoteSearchInput) (ListResult, error) {
	return ListResult{Items: []ShortLink{}, Page: 1, PageSize: 20}, s.err
}
func (s noteSearchFake) SearchAdminNotes(context.Context, auth.CurrentUser, NoteSearchInput) (AdminListResult, error) {
	return AdminListResult{Items: []AdminShortLink{}, Page: 1, PageSize: 20}, s.err
}
func (s noteSearchFake) ExportOwnNoteSearch(context.Context, auth.CurrentUser, NoteSearchInput) (ListExport, error) {
	return ListExport{FileName: "moeurl-links-own.csv"}, s.err
}
func (s noteSearchFake) ExportAdminNoteSearch(context.Context, auth.CurrentUser, NoteSearchInput) (ListExport, error) {
	return ListExport{FileName: "moeurl-links-all.csv"}, s.err
}

// TestNoteSearchHTTPFailures catches unsafe framing and infrastructure details leaking through any search route.
func TestNoteSearchHTTPFailures(t *testing.T) {
	for _, err := range []error{nil, ErrPermissionDenied, ErrInvalidStatus, ErrInvalidInput, ErrListExportLimit, errors.New("private-word secret SQL values")} {
		var logs bytes.Buffer
		h := NewNoteSearchHandler(noteSearchFake{err: err}, slog.New(slog.NewTextHandler(&logs, nil)))
		for i, run := range []http.HandlerFunc{h.List, h.AdminList, h.Export, h.AdminExport} {
			body := `{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"private-word"}`
			if i < 2 {
				body = strings.Replace(body, `{`, `{"page":1,"pageSize":20,`, 1)
			}
			r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			run(w, r)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			require.NotContains(t, w.Body.String(), "private-word")
			require.NotContains(t, logs.String(), "private-word")
			require.NotContains(t, logs.String(), "SQL values")
			switch err {
			case nil:
				require.Equal(t, 200, w.Code)
				require.Contains(t, w.Body.String(), `"code":0`)
			case ErrPermissionDenied:
				require.Contains(t, w.Body.String(), `"code":120001`)
			case ErrInvalidStatus, ErrInvalidInput:
				require.Contains(t, w.Body.String(), `"code":100001`)
			case ErrListExportLimit:
				require.Contains(t, w.Body.String(), `"code":200118`)
			default:
				require.Equal(t, 500, w.Code)
				require.Contains(t, w.Body.String(), `"code":900000`)
			}
		}
	}
	// Nil logger must still safely redact infrastructure details.
	NewNoteSearchHandler(noteSearchFake{}, nil)
	h := NewNoteSearchHandler(nil, nil)
	for _, run := range []http.HandlerFunc{h.List, h.AdminList, h.Export, h.AdminExport} {
		for _, tc := range []struct {
			url, media, body string
			headers          []string
			want             string
		}{
			{"/?x=secret", "application/json", `{}`, nil, `"code":100001`},
			{"/?", "application/json", `{}`, nil, `"code":100001`},
			{"/", "text/plain", `{}`, nil, `"code":100001`},
			{"/", "bad;=", `{}`, nil, `"code":100001`},
			{"/", "application/json", `{}`, nil, `"code":100001`},
			{"/", "application/json", `{}`, []string{"invalid"}, `"code":120001`},
			{"/", "application/json", `{}`, []string{"x", "y"}, `"code":120001`},
		} {
			r := httptest.NewRequestWithContext(t.Context(), "POST", tc.url, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			if tc.headers != nil {
				r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")] = tc.headers
			}
			w := httptest.NewRecorder()
			run(w, r)
			require.Contains(t, w.Body.String(), tc.want)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		}
	}
}

type noteSearchBrokenReader struct{}

func (noteSearchBrokenReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// TestNoteSearchDecodeFailures catches truncated framing and non-string filters before accessing a service.
func TestNoteSearchDecodeFailures(t *testing.T) {
	_, err := decodeNoteSearch(noteSearchBrokenReader{}, false)
	require.ErrorIs(t, err, ErrInvalidInput)
	for _, export := range []bool{false, true} {
		for _, raw := range []string{"", `{`, `{"x`, `{"q":`, `{"page":1}`, `{"q":"x","q":"y"}`, `{"q":"x",}`, `{"q":"x"`, `{"q":true}`, `{"unknown":1}`, `[]`, `null`, `{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"\ud800"}`, `{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"x"} {}`} {
			_, err := decodeNoteSearch(strings.NewReader(raw), export)
			require.ErrorIs(t, err, ErrInvalidInput, raw)
		}
	}
	for _, raw := range []string{`{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"x","page":1}`, `{"status":"","q":"","tag":"","noteStatus":"","noteQuery":"x","pageSize":20}`} {
		_, err := decodeNoteSearch(strings.NewReader(raw), true)
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}

// TestNoteSearchDecodeCorpus pins the wire integers and normalized private values independently of database results.
func TestNoteSearchDecodeCorpus(t *testing.T) {
	valid := `{"page":1,"pageSize":20,"status":"","q":"","tag":"","noteStatus":"","noteQuery":""}`
	for _, tc := range []struct {
		raw, want string
		invalid   bool
	}{
		{valid, "", false},
		{strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"  🌲x\u2003"`, 1), "🌲x", false},
		{strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\ufeff"`, 1), "\ufeff", false},
		{strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"\tword"`, 1), "", true},
		{strings.Replace(valid, `"noteQuery":""`, `"noteQuery":"`+strings.Repeat("x", 101)+`"`, 1), "", true},
		{strings.Replace(valid, `"noteQuery":""`, `"noteQuery":null`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":1.0`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":1e0`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":-0`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":"1"`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":2147483648`, 1), "", true},
		{strings.Replace(valid, `"pageSize":20`, `"pageSize":"20"`, 1), "", true},
		{strings.Replace(valid, `"pageSize":20`, `"pageSize":101`, 1), "", true},
		{strings.Replace(valid, `"page":1`, `"page":2147483647`, 1), "", true},
		{valid[:len(valid)-1] + `,`, "", true},
		{valid[:len(valid)-1] + `,"q":"again"}`, "", true},
		{string([]byte{0xff}), "", true},
		{strings.Repeat(" ", 16385) + valid, "", true},
	} {
		input, err := decodeNoteSearch(strings.NewReader(tc.raw), false)
		if tc.invalid {
			require.ErrorIs(t, err, ErrInvalidInput, tc.raw)
		} else {
			require.NoError(t, err)
			require.Equal(t, tc.want, input.NoteQuery)
			require.Equal(t, int32(1), input.Page)
			require.Equal(t, int32(20), input.PageSize)
		}
	}
	_, err := decodeNoteSearch(strings.NewReader(`{"status":"","q":"","tag":"","noteStatus":"","noteQuery":""}`), true)
	require.NoError(t, err)
}

// TestNoteSearchDirectValidation catches bypassing the decoder from trusted in-process callers.
func TestNoteSearchDirectValidation(t *testing.T) {
	service := NewService(nil, nil)
	for _, input := range []NoteSearchInput{
		{ListInput: ListInput{Page: 0, PageSize: 20}},
		{ListInput: ListInput{Page: 1, PageSize: 0}},
		{ListInput: ListInput{Page: 1, PageSize: 101}},
		{ListInput: ListInput{Page: 2147483647, PageSize: 100}},
		{ListInput: ListInput{Page: 1, PageSize: 20}, NoteQuery: "\t"},
		{ListInput: ListInput{Page: 1, PageSize: 20}, NoteQuery: string([]byte{0xff})},
		{ListInput: ListInput{Page: 1, PageSize: 20}, NoteQuery: strings.Repeat("🌲", 101)},
	} {
		_, err := service.SearchOwnNotes(t.Context(), auth.CurrentUser{}, input)
		require.ErrorIs(t, err, ErrInvalidInput)
		_, err = service.SearchAdminNotes(t.Context(), auth.CurrentUser{}, input)
		require.ErrorIs(t, err, ErrInvalidInput)
		if input.NoteQuery != "" {
			_, err = service.ExportOwnNoteSearch(t.Context(), auth.CurrentUser{}, input)
			require.ErrorIs(t, err, ErrInvalidInput)
			_, err = service.ExportAdminNoteSearch(t.Context(), auth.CurrentUser{}, input)
			require.ErrorIs(t, err, ErrInvalidInput)
		}
	}
}
