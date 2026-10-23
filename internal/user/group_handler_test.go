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

type groupPort struct {
	calls int
	err   error
	input user.ChangeGroupInput
}

// TestChangeGroupInfrastructureLogs classifies failures without exposing database diagnostics.
func TestChangeGroupInfrastructureLogs(t *testing.T) {
	for _, tc := range []struct {
		name     string
		err      error
		category string
	}{
		{"timeout", context.DeadlineExceeded, "timeout"},
		{"wrapped timeout", fmt.Errorf("private timeout detail: %w", context.DeadlineExceeded), "timeout"},
		{"canceled", context.Canceled, "canceled"},
		{"wrapped cancellation", fmt.Errorf("private cancellation detail: %w", context.Canceled), "canceled"},
		{"database", &pgconn.PgError{Code: "08006", Message: "private database message", Detail: "private database detail", Where: "private query"}, "infrastructure"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var logs bytes.Buffer
			service := &groupPort{err: tc.err}
			handler := user.NewGroupHandler(service, slog.New(slog.NewJSONHandler(&logs, nil)))
			request := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/admin/user/change-group", strings.NewReader(`{"id":"00000000-0000-0000-0000-000000000001","groupKey":"admin","expectedUpdatedAt":"2026-10-23T00:00:00.123456Z"}`))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Request-ID", "group-change-test")
			response := httptest.NewRecorder()
			middleware.RequestID(http.HandlerFunc(handler.Change)).ServeHTTP(response, request)

			require.Equal(t, http.StatusInternalServerError, response.Code)
			require.JSONEq(t, `{"code":900000,"message":"Internal server error","data":null,"meta":{}}`, response.Body.String())
			require.Equal(t, 1, service.calls)
			var entry map[string]any
			require.NoError(t, json.Unmarshal(logs.Bytes(), &entry))
			require.Equal(t, "ERROR", entry["level"])
			require.Equal(t, "user_group_change_failed", entry["msg"])
			require.Equal(t, "group-change-test", entry["request_id"])
			require.Equal(t, tc.category, entry["error_category"])
			require.Equal(t, fmt.Sprintf("%T", tc.err), entry["error_type"])
			require.Len(t, entry, 6) // Timestamp plus only the five safe fields above.
			for _, forbidden := range []string{tc.err.Error(), "08006", "private", "SQLSTATE"} {
				require.NotContains(t, logs.String(), forbidden)
			}
		})
	}
}

// ChangeGroup records the actual HTTP payload at the service boundary.
func (s *groupPort) ChangeGroup(_ context.Context, _ auth.CurrentUser, input user.ChangeGroupInput) (user.UpdateResult, error) {
	s.calls++
	s.input = input
	return user.UpdateResult{}, s.err
}

// TestChangeGroupHTTP rejects ambiguous documents before they can cause privileged writes.
func TestChangeGroupHTTP(t *testing.T) {
	valid := `{"id":"00000000-0000-0000-0000-000000000001","groupKey":"admin","expectedUpdatedAt":"2026-10-23T00:00:00.123456Z"}`
	for _, body := range []string{"", `null`, `[]`, `{}`, valid + ` {}`, valid + ` garbage`, strings.Replace(valid, `"groupKey":"admin"`, `"groupKey":null`, 1), strings.Replace(valid, `"groupKey":"admin"`, `"groupKey":"admin","unknown":true`, 1)} {
		s := &groupPort{}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		user.NewGroupHandler(s, nil).Change(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, s.calls)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		s := &groupPort{}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		user.NewGroupHandler(s, nil).Change(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, s.calls)
	}
	for _, tc := range []struct {
		err          error
		code, status int
	}{{nil, 0, 200}, {user.ErrVersionConflict, 300105, 200}, {user.ErrSelfGroupChange, 300106, 200}, {user.ErrInvalidInput, 100001, 200}, {user.ErrPermissionDenied, 120001, 200}, {user.ErrBuiltinUserImmutable, 300102, 200}, {user.ErrUserNotFound, 300103, 200}, {errors.New("private database detail"), 900000, 500}} {
		s := &groupPort{err: tc.err}
		r := httptest.NewRequestWithContext(t.Context(), "POST", "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		w := httptest.NewRecorder()
		user.NewGroupHandler(s, nil).Change(w, r)
		var result struct{ Code int }
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
		require.Equal(t, tc.code, result.Code)
		require.Equal(t, tc.status, w.Code)
		require.Equal(t, 1, s.calls)
		require.Equal(t, "admin", s.input.GroupKey)
		require.NotContains(t, w.Body.String(), "private database detail")
	}
}
