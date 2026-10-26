package shortlink_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type batchTagsPort struct{ err error }

// BatchTags supplies a deterministic external service outcome for personal HTTP boundaries.
func (p batchTagsPort) BatchTags(context.Context, auth.CurrentUser, shortlink.BatchTagsInput) (shortlink.BatchTagsResult, error) {
	return shortlink.BatchTagsResult{ChangedCount: 1}, p.err
}

// AdminBatchTags distinguishes administrative dispatch in the public aggregate response.
func (p batchTagsPort) AdminBatchTags(context.Context, auth.CurrentUser, shortlink.BatchTagsInput) (shortlink.BatchTagsResult, error) {
	return shortlink.BatchTagsResult{UnchangedCount: 1}, p.err
}

const validBatchTagsJSON = `{"items":[{"id":"00000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-10-23T00:00:00.123456Z"}],"operation":"add","tags":["private-tag"]}`

// TestBatchTagsHTTP catches permissive JSON decoding, wrong dispatch and leaked database diagnostics.
func TestBatchTagsHTTP(t *testing.T) {
	for _, admin := range []bool{false, true} {
		t.Run(map[bool]string{false: "personal", true: "admin"}[admin], func(t *testing.T) {
			for _, body := range []string{"", `null`, `[]`, `{}`, validBatchTagsJSON + ` {}`, validBatchTagsJSON + ` trailing`, strings.Replace(validBatchTagsJSON, `"tags":["private-tag"]`, `"tags":null`, 1), strings.Replace(validBatchTagsJSON, `"tags":["private-tag"]`, `"tags":[null]`, 1), strings.Replace(validBatchTagsJSON, `"operation":"add",`, "", 1), strings.Replace(validBatchTagsJSON, `"id":`, `"unknown":true,"id":`, 1), strings.Replace(validBatchTagsJSON, `"operation":`, `"unknown":true,"operation":`, 1), strings.Replace(validBatchTagsJSON, "private-tag", string([]byte{0xff}), 1)} {
				r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				w := httptest.NewRecorder()
				h := shortlink.NewBatchTagsHandler(batchTagsPort{}, nil)
				if admin {
					h.AdminBatchTags(w, r)
				} else {
					h.BatchTags(w, r)
				}
				require.Equal(t, 200, w.Code)
				require.Contains(t, w.Body.String(), `"code":100001`, body)
			}
			for _, media := range []string{"", "text/plain", "application/json; broken"} {
				r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(validBatchTagsJSON))
				r.Header.Set("Content-Type", media)
				w := httptest.NewRecorder()
				shortlink.NewBatchTagsHandler(batchTagsPort{}, nil).BatchTags(w, r)
				require.Contains(t, w.Body.String(), `"code":100001`)
			}
			for _, tc := range []struct {
				err    error
				code   string
				status int
			}{
				{nil, `"code":0`, 200}, {shortlink.ErrInvalidInput, `"code":100001`, 200}, {shortlink.ErrPermissionDenied, `"code":120001`, 200},
				{shortlink.ErrShortLinkMissing, `"code":200104`, 200}, {shortlink.ErrTransferConflict, `"code":200116`, 200}, {shortlink.ErrBatchTagsLimit, `"code":200119`, 200},
				{context.DeadlineExceeded, `"code":900000`, 500}, {context.Canceled, `"code":900000`, 500}, {errors.New("private-tag SQLSTATE 23505 https://secret.example"), `"code":900000`, 500},
			} {
				var logs bytes.Buffer
				r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(validBatchTagsJSON))
				r.Header.Set("Content-Type", "application/json; charset=utf-8")
				w := httptest.NewRecorder()
				h := shortlink.NewBatchTagsHandler(batchTagsPort{tc.err}, slog.New(slog.NewJSONHandler(&logs, nil)))
				if admin {
					h.AdminBatchTags(w, r)
				} else {
					h.BatchTags(w, r)
				}
				require.Equal(t, tc.status, w.Code)
				require.Contains(t, w.Body.String(), tc.code)
				if tc.err == nil {
					want := `"changedCount":1,"unchangedCount":0`
					if admin {
						want = `"changedCount":0,"unchangedCount":1`
					}
					require.Contains(t, w.Body.String(), want)
				}
				for _, secret := range []string{"private-tag", "SQLSTATE", "23505", "secret.example"} {
					require.NotContains(t, logs.String(), secret)
					require.NotContains(t, w.Body.String(), secret)
				}
				if tc.status == 500 {
					require.Contains(t, logs.String(), `"error_category"`)
					require.Contains(t, logs.String(), `"error_type"`)
				}
			}
		})
	}
	r := httptest.NewRequestWithContext(t.Context(), "POST", "/", nil)
	r.Body = io.NopCloser(batchTagsFailingReader{})
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	shortlink.NewBatchTagsHandler(batchTagsPort{}, nil).BatchTags(w, r)
	require.Contains(t, w.Body.String(), `"code":100001`)
}

type batchTagsFailingReader struct{}

// Read models a disconnected request stream rather than valid JSON.
func (batchTagsFailingReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }
