package shortlink_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type batchTransferPort struct{ err error }

// BatchTransfer returns a fixed aggregate so HTTP tests assert the public response contract.
func (p batchTransferPort) BatchTransfer(context.Context, auth.CurrentUser, shortlink.BatchTransferInput) (shortlink.BatchTransferResult, error) {
	return shortlink.BatchTransferResult{TransferredCount: 1}, p.err
}

// TestBatchTransferHTTP rejects invalid framing and preserves safe errors and exact aggregates.
func TestBatchTransferHTTP(t *testing.T) {
	valid := `{"items":[{"id":"00000000-0000-0000-0000-000000000001","expectedUpdatedAt":"2026-10-23T00:00:00.123456Z"}],"newOwnerUsername":"recipient"}`
	for _, body := range []string{"", `null`, `[]`, `{}`, valid + ` {}`, valid + ` trailing`, `{"items":null,"newOwnerUsername":"recipient"}`, `{"items":[null],"newOwnerUsername":"recipient"}`, strings.Replace(valid, `"recipient"`, `null`, 1), strings.Replace(valid, `"recipient"`, `1`, 1), strings.Replace(valid, `"id":`, `"unknown":true,"id":`, 1), strings.Replace(valid, `"newOwnerUsername":`, `"unknown":true,"newOwnerUsername":`, 1)} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		shortlink.NewBatchTransferHandler(batchTransferPort{}, nil).BatchTransfer(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":100001`)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		shortlink.NewBatchTransferHandler(batchTransferPort{}, nil).BatchTransfer(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
	}
	for _, tc := range []struct {
		err    error
		code   string
		status int
	}{
		{nil, `"code":0`, 200}, {shortlink.ErrInvalidInput, `"code":100001`, 200}, {shortlink.ErrPermissionDenied, `"code":120001`, 200},
		{shortlink.ErrShortLinkMissing, `"code":200104`, 200}, {shortlink.ErrTransferConflict, `"code":200116`, 200}, {shortlink.ErrTransferRecipientUnavailable, `"code":200117`, 200},
		{context.DeadlineExceeded, `"code":900000`, 500}, {context.Canceled, `"code":900000`, 500}, {errors.New("private SQLSTATE 23505 https://secret.example"), `"code":900000`, 500},
	} {
		var logs bytes.Buffer
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		w := httptest.NewRecorder()
		shortlink.NewBatchTransferHandler(batchTransferPort{tc.err}, slog.New(slog.NewJSONHandler(&logs, nil))).BatchTransfer(w, r)
		require.Equal(t, tc.status, w.Code)
		require.Contains(t, w.Body.String(), tc.code)
		if tc.err == nil {
			require.Contains(t, w.Body.String(), `"transferredCount":1,"unchangedCount":0`)
		}
		for _, secret := range []string{"private", "SQLSTATE", "23505", "secret.example"} {
			require.NotContains(t, logs.String(), secret)
			require.NotContains(t, w.Body.String(), secret)
		}
		if tc.status == 500 {
			require.Contains(t, logs.String(), `"error_category"`)
			require.Contains(t, logs.String(), `"error_type"`)
		}
	}
}
