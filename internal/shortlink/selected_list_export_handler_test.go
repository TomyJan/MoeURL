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

type selectedListExportFake struct{ err error }

func (s selectedListExportFake) ExportSelectedList(context.Context, auth.CurrentUser, SelectedListExportInput) (ListExport, error) {
	return ListExport{FileName: "moeurl-links-own-selected.csv"}, s.err
}

func (s selectedListExportFake) AdminExportSelectedList(context.Context, auth.CurrentUser, SelectedListExportInput) (ListExport, error) {
	return ListExport{FileName: "moeurl-links-all-selected.csv"}, s.err
}

// TestSelectedListExportHTTPFailures catches unsafe diagnostics and wrong public response categories.
func TestSelectedListExportHTTPFailures(t *testing.T) {
	const body = `{"ids":["00000000-0000-0000-0000-00000000e601"]}`
	for _, err := range []error{nil, ErrInvalidInput, ErrPermissionDenied, ErrListExportLimit, errors.New("private SQL ids credentials")} {
		var logs bytes.Buffer
		h := NewSelectedListExportHandler(selectedListExportFake{err}, slog.New(slog.NewTextHandler(&logs, nil)))
		for i, run := range []http.HandlerFunc{h.List, h.AdminList} {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			run(w, r)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			require.NotContains(t, w.Body.String(), "private SQL")
			require.NotContains(t, logs.String(), "credentials")
			switch err {
			case nil:
				require.Equal(t, 200, w.Code)
				require.Contains(t, w.Body.String(), `"code":0`)
				name := "own"
				if i == 1 {
					name = "all"
				}
				require.Contains(t, w.Body.String(), "moeurl-links-"+name+"-selected.csv")
			case ErrInvalidInput:
				require.Contains(t, w.Body.String(), `"code":100001`)
			case ErrPermissionDenied:
				require.Contains(t, w.Body.String(), `"code":120001`)
			case ErrListExportLimit:
				require.Contains(t, w.Body.String(), `"code":200118`)
			default:
				require.Equal(t, 500, w.Code)
				require.Contains(t, w.Body.String(), `"code":900000`)
				require.Contains(t, logs.String(), "short_link_selected_list_export_failed")
			}
		}
	}
	// Constructor defaults remain safe without caller-supplied diagnostics.
	h := NewSelectedListExportHandler(selectedListExportFake{}, nil)
	for _, run := range []http.HandlerFunc{h.List, h.AdminList} {
		for _, tc := range []struct {
			path, media, body string
			headers           []string
			want              string
		}{
			{"/?secret=x", "application/json", body, nil, `"code":100001`},
			{"/?", "application/json", body, nil, `"code":100001`},
			{"/", "text/plain", body, nil, `"code":100001`},
			{"/", "bad;=", body, nil, `"code":100001`},
			{"/", "application/json", `{}`, nil, `"code":100001`},
			{"/", "application/json", body, []string{"invalid"}, `"code":120001`},
			{"/", "application/json", body, []string{"x", "y"}, `"code":120001`},
		} {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, tc.path, strings.NewReader(tc.body))
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

type selectedListExportBrokenReader struct{}

func (selectedListExportBrokenReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// TestSelectedListExportDecodeFailures catches malformed tokens and read failures before any business call.
func TestSelectedListExportDecodeFailures(t *testing.T) {
	_, err := decodeSelectedListExport(selectedListExportBrokenReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	for _, raw := range []string{"", `{`, `{"`, `{"ids":`, `{"ids":[]`, `{"ids":[],`, `{"ids":["00000000-0000-0000-0000-00000000e601"]}x`, `{"ids":[],"other":1}`, `{"other":[]}`, `{"ids":[]}`, `{"ids":null}`, `{"ids":[""]}`, `{"ids":["00000000-0000-0000-0000-00000000e601","00000000-0000-0000-0000-00000000e601"]}`, `null`, `[]`, string([]byte{255}), strings.Repeat(" ", 16385)} {
		_, err := decodeSelectedListExport(strings.NewReader(raw))
		require.ErrorIs(t, err, ErrInvalidInput)
	}
}
