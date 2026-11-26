package user_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/user"
	"github.com/stretchr/testify/require"
)

type membershipPort struct {
	calls  int
	input  user.UpdateGroupMembershipsInput
	result user.UpdateResult
	err    error
}

func (p *membershipPort) UpdateGroupMemberships(_ context.Context, _ auth.CurrentUser, input user.UpdateGroupMembershipsInput) (user.UpdateResult, error) {
	p.calls++
	p.input = input
	return p.result, p.err
}

func TestUpdateGroupMembershipsHTTPRequiresStrictCompleteJSON(t *testing.T) {
	valid := `{"id":"00000000-0000-4000-8000-000000000001","groupKeys":[],"expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"}`
	for _, body := range []string{
		"", `null`, `[]`, `{}`, `{"id":"00000000-0000-4000-8000-000000000001","expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"}`,
		strings.Replace(valid, `"groupKeys":[]`, `"groupKeys":null`, 1),
		strings.Replace(valid, `"groupKeys":[]`, `"groupKeys":[],"extra":true`, 1),
		valid + ` {}`, valid + ` trailing`,
	} {
		port := &membershipPort{}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		user.NewMembershipHandler(port, nil).Update(w, r)
		require.Equal(t, http.StatusOK, w.Code)
		require.Contains(t, w.Body.String(), `"code":100001`, "%s", body)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.Zero(t, port.calls)
	}
	for _, media := range []string{"", "text/plain", "application/json; broken"} {
		port := &membershipPort{}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", media)
		w := httptest.NewRecorder()
		user.NewMembershipHandler(port, nil).Update(w, r)
		require.Contains(t, w.Body.String(), `"code":100001`)
		require.Zero(t, port.calls)
	}
}

func TestUpdateGroupMembershipsHTTPMapsBusinessAndInfrastructureErrors(t *testing.T) {
	valid := `{"id":"00000000-0000-4000-8000-000000000001","groupKeys":[],"expectedUpdatedAt":"2026-10-28T01:02:03.123456Z"}`
	for _, tc := range []struct {
		err          error
		code, status int
	}{
		{nil, 0, http.StatusOK}, {user.ErrInvalidInput, 100001, http.StatusOK},
		{user.ErrPermissionDenied, 120001, http.StatusOK}, {user.ErrUserNotFound, 300103, http.StatusOK},
		{user.ErrBuiltinUserImmutable, 300102, http.StatusOK}, {user.ErrSelfGroupChange, 300106, http.StatusOK},
		{user.ErrVersionConflict, 300105, http.StatusOK}, {errors.New("private database detail"), 900000, http.StatusInternalServerError},
	} {
		port := &membershipPort{err: tc.err}
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/", strings.NewReader(valid))
		r.Header.Set("Content-Type", "application/json; charset=utf-8")
		w := httptest.NewRecorder()
		user.NewMembershipHandler(port, nil).Update(w, r)
		var response struct {
			Code int
			Data json.RawMessage
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
		require.Equal(t, tc.code, response.Code)
		require.Equal(t, tc.status, w.Code)
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		require.NotContains(t, w.Body.String(), "private")
		require.Equal(t, 1, port.calls)
		require.NotNil(t, port.input.GroupKeys, "an explicit empty array is distinct from omitted or null")
	}
}
