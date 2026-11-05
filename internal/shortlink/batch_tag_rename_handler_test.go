package shortlink

import (
	"bytes"
	"context"
	"encoding/json"
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

const renameJSON = `{"items":[{"id":"10000000-0000-4000-8000-000000000001","expectedUpdatedAt":"2026-11-05T03:00:00.123456789Z"}],"fromTag":"old","toTag":"new"}`

// TestBatchTagRenameStrictJSON catches permissive framing, Unicode replacement and erased duplicate fields.
func TestBatchTagRenameStrictJSON(t *testing.T) {
	for _, raw := range []string{
		``, `[]`, `null`, `{`, `{"items":`, `{"items":[]`, `{"items":[],`, `{"items":[]}`, `{"items":[],"fromTag":"old"}`,
		strings.Replace(renameJSON, `"fromTag":"old"`, `"fromTag":"old","fromTag":"other"`, 1),
		strings.Replace(renameJSON, `"fromTag"`, `"FromTag"`, 1),
		strings.Replace(renameJSON, `"toTag":"new"`, `"unknown":"new"`, 1),
		strings.Replace(renameJSON, `"toTag":"new"`, `"toTag":null`, 1),
		strings.Replace(renameJSON, `"toTag":"new"`, `"toTag":12`, 1),
		strings.Replace(renameJSON, `"old"`, `"\ud800"`, 1),
		strings.Replace(renameJSON, `"new"`, `"\udfff"`, 1),
		strings.Replace(renameJSON, `"old"`, `"\told"`, 1),
		strings.Replace(renameJSON, `"new"`, `"new\n"`, 1),
		strings.Replace(renameJSON, `"new"`, `" old "`, 1),
		strings.Replace(renameJSON, `"new"`, `"`+string([]byte{0xff})+`"`, 1),
		strings.Replace(renameJSON, `"items":[`, `"items":null,"unused":[`, 1),
		strings.Replace(renameJSON, `"expectedUpdatedAt":`, `"id":"10000000-0000-4000-8000-000000000001","expectedUpdatedAt":`, 1),
		strings.Replace(renameJSON, `"expectedUpdatedAt"`, `"ExpectedUpdatedAt"`, 1),
		strings.Replace(renameJSON, `"id":"10000000-0000-4000-8000-000000000001"`, `"id":"10000000-0000-4000-8000-00000000000A"`, 1),
		strings.Replace(renameJSON, `"expectedUpdatedAt":"2026-11-05T03:00:00.123456789Z"`, `"expectedUpdatedAt":null`, 1),
		strings.Replace(renameJSON, `"expectedUpdatedAt":"2026-11-05T03:00:00.123456789Z"`, `"expectedUpdatedAt":"0000-01-01T00:00:00Z"`, 1),
		renameJSON + ` {}`, renameJSON + `x`, strings.Repeat(" ", 65537) + renameJSON,
	} {
		t.Run(raw, func(t *testing.T) {
			_, err := decodeBatchTagRename(strings.NewReader(raw))
			require.ErrorIs(t, err, ErrInvalidInput)
		})
	}
	_, err := decodeBatchTagRename(batchNoteBrokenReader{})
	require.ErrorIs(t, err, ErrInvalidInput)
	for _, raw := range []string{renameJSON, strings.Repeat(" ", 65536-len(renameJSON)) + renameJSON, strings.Replace(renameJSON, `"old"`, `" old "`, 1), strings.Replace(renameJSON, `"new"`, `"\ud83d\ude00"`, 1)} {
		input, err := decodeBatchTagRename(strings.NewReader(raw))
		require.NoError(t, err)
		require.Equal(t, "old", input.FromTag)
		require.Len(t, input.Items, 1)
	}
}

type tagRenameFailurePort struct{ err error }

func (p tagRenameFailurePort) RenameOwnTags(_ context.Context, _ auth.CurrentUser, in BatchTagRenameInput) (BatchTagsResult, error) {
	if len(in.Items) != 1 || in.FromTag != "old" || in.ToTag != "new" {
		return BatchTagsResult{}, errors.New("unexpected request")
	}
	return BatchTagsResult{ChangedCount: 1}, p.err
}
func (p tagRenameFailurePort) RenameAdminTags(ctx context.Context, u auth.CurrentUser, in BatchTagRenameInput) (BatchTagsResult, error) {
	_, err := p.RenameOwnTags(ctx, u, in)
	return BatchTagsResult{UnchangedCount: 1}, err
}

// TestBatchTagRenameHTTPBoundary checks scoped dispatch, safe errors and no-store on every result.
func TestBatchTagRenameHTTPBoundary(t *testing.T) {
	for _, tc := range []struct {
		err          error
		status, code int
	}{{nil, 200, 0}, {ErrInvalidInput, 200, 100001}, {ErrPermissionDenied, 200, 120001}, {ErrShortLinkMissing, 200, 200104}, {ErrTransferConflict, 200, 200116}, {errors.New("private-tag-canary SQL values"), 500, 900000}} {
		var logs bytes.Buffer
		h := NewBatchTagRenameHandler(tagRenameFailurePort{tc.err}, slog.New(slog.NewTextHandler(&logs, nil)))
		for i, run := range []http.HandlerFunc{h.RenameOwn, h.RenameAdmin} {
			r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(renameJSON))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			run(w, r)
			require.Equal(t, tc.status, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var result struct {
				Code int             `json:"code"`
				Data BatchTagsResult `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Equal(t, tc.code, result.Code)
			if tc.err == nil {
				if i == 0 {
					require.Equal(t, 1, result.Data.ChangedCount)
				} else {
					require.Equal(t, 1, result.Data.UnchangedCount)
				}
			}
			require.NotContains(t, logs.String(), "private-tag-canary")
			require.NotContains(t, logs.String(), "SQL values")
			require.NotContains(t, w.Body.String(), "private-tag-canary")
		}
	}
	h := NewBatchTagRenameHandler(tagRenameFailurePort{}, nil)
	for _, tc := range []struct {
		url, media, body string
		invalidIdentity  bool
		code             int
	}{
		{"/?", "application/json", renameJSON, false, 100001}, {"/?x=1", "application/json", renameJSON, false, 100001}, {"/", "text/plain", renameJSON, false, 100001}, {"/", "bad;=", renameJSON, false, 100001}, {"/", "application/json", "{}", false, 100001}, {"/", "application/json", renameJSON, true, 120001},
	} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", tc.url, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", tc.media)
		if tc.invalidIdentity {
			r.Header.Set("X-MoeURL-Expected-User-ID", "bad")
		}
		w := httptest.NewRecorder()
		h.RenameOwn(w, r)
		var result struct {
			Code int `json:"code"`
		}
		require.NoError(t, json.NewDecoder(w.Body).Decode(&result))
		require.Equal(t, tc.code, result.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	}
	// A real reader error remains an invalid request rather than dispatching a zero input.
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", io.NopCloser(batchNoteBrokenReader{}))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.RenameAdmin(w, r)
	require.Contains(t, w.Body.String(), `"code":100001`)
}
