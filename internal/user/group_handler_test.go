package user_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

type groupPort struct {
	calls int
	err   error
	input user.ChangeGroupInput
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
