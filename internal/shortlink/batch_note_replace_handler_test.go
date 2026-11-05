package shortlink

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/stretchr/testify/require"
)

type batchNoteReplaceFake struct{ err error }

func (s batchNoteReplaceFake) PreviewOwnNoteReplace(context.Context, auth.CurrentUser, BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error) {
	return BatchNoteReplacePreviewResult{UnchangedCount: 1}, s.err
}
func (s batchNoteReplaceFake) PreviewAdminNoteReplace(context.Context, auth.CurrentUser, BatchNoteReplacePreviewInput) (BatchNoteReplacePreviewResult, error) {
	return BatchNoteReplacePreviewResult{UnchangedCount: 1}, s.err
}
func (s batchNoteReplaceFake) ReplaceOwnNotes(context.Context, auth.CurrentUser, BatchNoteReplaceInput) (BatchNoteClearResult, error) {
	return BatchNoteClearResult{UnchangedCount: 1}, s.err
}
func (s batchNoteReplaceFake) ReplaceAdminNotes(context.Context, auth.CurrentUser, BatchNoteReplaceInput) (BatchNoteClearResult, error) {
	return BatchNoteClearResult{UnchangedCount: 1}, s.err
}

// TestBatchNoteReplaceHTTPFailures checks safe error mapping and dispatch for each fixed route.
func TestBatchNoteReplaceHTTPFailures(t *testing.T) {
	for _, cause := range []error{nil, ErrPermissionDenied, ErrShortLinkMissing, ErrTransferConflict, ErrInvalidInput, errors.New("private-note-canary SQL values")} {
		var logs bytes.Buffer
		h := NewBatchNoteReplaceHandler(batchNoteReplaceFake{cause}, slog.New(slog.NewTextHandler(&logs, nil)))
		for i, run := range []http.HandlerFunc{h.PreviewOwn, h.PreviewAdmin, h.ReplaceOwn, h.ReplaceAdmin} {
			body := `{"items":[{"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-11-04T00:00:00Z"`
			if i >= 2 {
				body += `,"expectedNoteUpdatedAt":"2026-11-04T00:00:00Z"`
			}
			body += `}],"note":"new"}`
			r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			run(w, r)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			require.NotContains(t, w.Body.String(), "private-note-canary")
			require.NotContains(t, logs.String(), "private-note-canary")
			require.NotContains(t, logs.String(), "SQL values")
			switch cause {
			case nil:
				require.Contains(t, w.Body.String(), `"code":0`)
			case ErrPermissionDenied:
				require.Contains(t, w.Body.String(), `"code":120001`)
			case ErrShortLinkMissing:
				require.Contains(t, w.Body.String(), `"code":200104`)
			case ErrTransferConflict:
				require.Contains(t, w.Body.String(), `"code":200116`)
			case ErrInvalidInput:
				require.Contains(t, w.Body.String(), `"code":100001`)
			default:
				require.Equal(t, 500, w.Code)
				require.Contains(t, w.Body.String(), `"code":900000`)
			}
		}
	}
	h := NewBatchNoteReplaceHandler(batchNoteReplaceFake{}, nil)
	for _, run := range []http.HandlerFunc{h.PreviewOwn, h.PreviewAdmin, h.ReplaceOwn, h.ReplaceAdmin} {
		for _, tc := range []struct {
			url, media, body string
			headers          []string
			want             string
		}{
			{"/?", "application/json", `{"items":[{"id":"af000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-11-04T00:00:00Z"}]}`, nil, `"code":100001`},
			{"/?x=1", "application/json", `{}`, nil, `"code":100001`},
			{"/", "text/plain", `{}`, nil, `"code":100001`},
			{"/", "bad;=", `{}`, nil, `"code":100001`},
			{"/", "application/json", `{}`, nil, `"code":100001`},
			{"/", "application/json", `{}`, []string{"invalid"}, `"code":120001`},
		} {
			r := httptest.NewRequestWithContext(t.Context(), "POST", tc.url, strings.NewReader(tc.body))
			r.Header.Set("Content-Type", tc.media)
			if tc.headers != nil {
				r.Header[http.CanonicalHeaderKey("X-MoeURL-Expected-User-ID")] = tc.headers
			}
			w := httptest.NewRecorder()
			run(w, r)
			require.Contains(t, w.Body.String(), tc.want)
		}
	}
}
