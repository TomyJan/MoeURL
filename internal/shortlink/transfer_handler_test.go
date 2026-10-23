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

type transferPort struct {
	calls int
	err   error
}

// Transfer isolates HTTP framing from the database service and records dispatch.
func (p *transferPort) Transfer(context.Context, auth.CurrentUser, shortlink.TransferInput) (shortlink.TransferResult, error) {
	p.calls++
	return shortlink.TransferResult{}, p.err
}

// TestTransferHTTP rejects ambiguous request documents and preserves the numeric error contract.
func TestTransferHTTP(t *testing.T) {
	valid := `{"id":"00000000-0000-0000-0000-000000000001","newOwnerUsername":"recipient","expectedUpdatedAt":"2026-10-23T00:00:00.123456Z"}`
	for _, body := range []string{"", `null`, `[]`, `{}`, valid + ` {}`, valid + ` trailing`, strings.Replace(valid, `"newOwnerUsername":"recipient"`, `"newOwnerUsername":null`, 1), strings.Replace(valid, `"newOwnerUsername":"recipient"`, `"newOwnerUsername":"recipient","unknown":true`, 1)} {
		port := &transferPort{}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		shortlink.NewTransferHandler(port, nil).Transfer(w, r)
		require.Equal(t, 200, w.Code)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, port.calls)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		port := &transferPort{}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		shortlink.NewTransferHandler(port, nil).Transfer(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, port.calls)
	}
	for _, tc := range []struct {
		err    error
		code   string
		status int
	}{
		{nil, `"code":0`, 200}, {shortlink.ErrInvalidInput, `"code":100001`, 200},
		{shortlink.ErrPermissionDenied, `"code":120001`, 200}, {shortlink.ErrShortLinkMissing, `"code":200104`, 200},
		{shortlink.ErrTransferConflict, `"code":200116`, 200}, {shortlink.ErrTransferRecipientUnavailable, `"code":200117`, 200},
		{context.DeadlineExceeded, `"code":900000`, 500}, {context.Canceled, `"code":900000`, 500}, {errors.New("private SQLSTATE 23505 detail"), `"code":900000`, 500},
	} {
		var logs bytes.Buffer
		port := &transferPort{err: tc.err}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		shortlink.NewTransferHandler(port, slog.New(slog.NewJSONHandler(&logs, nil))).Transfer(w, r)
		require.Equal(t, tc.status, w.Code)
		require.Contains(t, w.Body.String(), tc.code)
		require.Equal(t, 1, port.calls)
		require.NotContains(t, logs.String(), "private")
		require.NotContains(t, logs.String(), "23505")
		require.NotContains(t, w.Body.String(), "SQLSTATE")
	}
}
