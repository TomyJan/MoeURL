package user_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/middleware"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/require"
)

type batchGroupPort struct {
	calls int
	input user.BatchChangeGroupInput
	err   error
}

// BatchChangeGroup exposes boundary payloads and deterministic errors; production HTTP/DB behavior is covered by App tests.
func (s *batchGroupPort) BatchChangeGroup(_ context.Context, _ auth.CurrentUser, input user.BatchChangeGroupInput) (user.BatchChangeGroupResult, error) {
	s.calls++
	s.input = input
	return user.BatchChangeGroupResult{ChangedCount: 1}, s.err
}

// TestBatchChangeGroupHTTP catches unknown/nested/ambiguous documents before any privileged operation is attempted.
func TestBatchChangeGroupHTTP(t *testing.T) {
	valid := `{"items":[{"id":"00000000-0000-4000-8000-000000000001","expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"}],"groupKey":"admin"}`
	for _, body := range []string{
		"", `null`, `[]`, `{}`, `{"items":null,"groupKey":"admin"}`, `{"items":[],"groupKey":"admin"}`,
		`{"items":[null],"groupKey":"admin"}`, `{"items":[{}],"groupKey":"admin"}`,
		strings.Replace(valid, `"groupKey":"admin"`, `"groupKey":null`, 1),
		strings.Replace(valid, `"groupKey":"admin"`, `"groupKey":"admin","extra":true`, 1),
		strings.Replace(valid, `"expectedUpdatedAt":`, `"extra":true,"expectedUpdatedAt":`, 1),
		strings.Replace(valid, `"expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"`, `"expectedUpdatedAt":null`, 1),
		strings.Replace(valid, `"id":"00000000-0000-4000-8000-000000000001"`, `"id":true`, 1),
		valid + ` {}`, valid + ` trailing`,
		`{"items":[` + strings.TrimSuffix(strings.Repeat(`{"id":"x","expectedUpdatedAt":"y"},`, 101), ",") + `],"groupKey":"admin"}`,
	} {
		s := &batchGroupPort{}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		user.NewBatchGroupHandler(s, nil).Change(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Contains(t, w.Body.String(), `"code":100001`, "%s", body)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.Zero(t, s.calls)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		s := &batchGroupPort{}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		user.NewBatchGroupHandler(s, nil).Change(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, s.calls)
	}
	for _, tc := range []struct {
		err          error
		code, status int
	}{
		{nil, 0, 200}, {user.ErrInvalidInput, 100001, 200}, {user.ErrPermissionDenied, 120001, 200},
		{user.ErrUserNotFound, 300103, 200}, {user.ErrBuiltinUserImmutable, 300102, 200},
		{user.ErrSelfGroupChange, 300106, 200}, {user.ErrVersionConflict, 300105, 200}, {errors.New("private database detail"), 900000, 500},
	} {
		s := &batchGroupPort{err: tc.err}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		w := httptest.NewRecorder()
		user.NewBatchGroupHandler(s, nil).Change(w, r)
		var response struct {
			Code int
			Data json.RawMessage
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, tc.code, response.Code)
		require.Equal(t, tc.status, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String(), "private")
		require.Equal(t, 1, s.calls)
		require.Equal(t, "2026-10-28T01:02:03.123456Z", s.input.Items[0].ExpectedUpdatedAt)
		if tc.err == nil {
			require.JSONEq(t, `{"changedCount":1,"unchangedCount":0}`, string(response.Data))
		} else {
			require.Equal(t, "null", string(response.Data))
		}
	}
}

// TestBatchChangeGroupInfrastructureLogs keeps database diagnostics, request IDs and timestamp tokens out of unsafe fields.
func TestBatchChangeGroupInfrastructureLogs(t *testing.T) {
	for _, tc := range []struct {
		err      error
		category string
	}{
		{context.DeadlineExceeded, "timeout"}, {fmt.Errorf("private: %w", context.DeadlineExceeded), "timeout"},
		{context.Canceled, "canceled"}, {fmt.Errorf("private: %w", context.Canceled), "canceled"},
		{&pgconn.PgError{Code: "08006", Message: "private database message", Detail: "private query"}, "infrastructure"},
	} {
		var logs bytes.Buffer
		s := &batchGroupPort{err: tc.err}
		h := user.NewBatchGroupHandler(s, slog.New(slog.NewJSONHandler(&logs, nil)))
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(`{"items":[{"id":"00000000-0000-4000-8000-000000000001","expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"}],"groupKey":"admin"}`))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Request-ID", "batch-command-test")
		w := httptest.NewRecorder()
		middleware.RequestID(http.HandlerFunc(h.Change)).ServeHTTP(w, r)
		require.Equal(t, http.StatusInternalServerError, w.Code)
		var entry map[string]any
		require.NoError(t, json.Unmarshal(logs.Bytes(), &entry))
		require.Equal(t, "user_batch_group_change_failed", entry["msg"])
		require.Equal(t, "batch-command-test", entry["request_id"])
		require.Equal(t, tc.category, entry["error_category"])
		require.Equal(t, fmt.Sprintf("%T", tc.err), entry["error_type"])
		require.Len(t, entry, 6)
		for _, forbidden := range []string{"private", "08006", "SQLSTATE", "00000000-0000", "01:02:03.123456Z"} {
			require.NotContains(t, logs.String(), forbidden)
		}
	}
}
