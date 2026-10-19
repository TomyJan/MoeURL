package shortlink_test

import (
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
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type batchStub struct {
	input         shortlink.BatchInput
	user          auth.CurrentUser
	admin, called bool
	err           error
}

// Batch captures dispatch and returns the public success contract.
func (s *batchStub) Batch(_ context.Context, user auth.CurrentUser, input shortlink.BatchInput) (shortlink.BatchResult, error) {
	s.user, s.input, s.called = user, input, true
	return shortlink.BatchResult{AffectedCount: int64(len(input.IDs))}, s.err
}

// AdminBatch records selection of the independent administrative endpoint.
func (s *batchStub) AdminBatch(ctx context.Context, user auth.CurrentUser, input shortlink.BatchInput) (shortlink.BatchResult, error) {
	s.admin = true
	return s.Batch(ctx, user, input)
}

// TestBatchHTTPStrictContract checks parsing, route wiring, identity, envelopes and no-store in both scopes.
func TestBatchHTTPStrictContract(t *testing.T) {
	require.NotNil(t, shortlink.NewBatchHandler(&batchStub{}, nil))
	require.NotNil(t, shortlink.NewBatchHandler(&batchStub{}, slog.Default()))
	const valid = `{"ids":["00000000-0000-0000-0000-000000000001"],"action":"disable"}`
	for _, admin := range []bool{false, true} {
		path := "/api/v1/short-link/batch"
		if admin {
			path = "/api/v1/admin/short-link/batch"
		}
		for _, test := range []struct {
			body         string
			err          error
			status, code int
		}{
			{valid, nil, 200, 0}, {"", nil, 200, 100001}, {"null", nil, 200, 100001}, {"[]", nil, 200, 100001}, {"{}", nil, 200, 100001},
			{`{"action":"disable"}`, nil, 200, 100001}, {`{"ids":null,"action":"disable"}`, nil, 200, 100001}, {`{"ids":[],"action":"disable"}`, nil, 200, 100001},
			{`{"ids":1,"action":"disable"}`, nil, 200, 100001}, {`{"ids":[1],"action":"disable"}`, nil, 200, 100001}, {`{"ids":[null],"action":"disable"}`, nil, 200, 100001},
			{`{"ids":["bad"],"action":"disable"}`, nil, 200, 100001}, {strings.Replace(valid, `"disable"`, `null`, 1), nil, 200, 100001}, {strings.Replace(valid, `"disable"`, `1`, 1), nil, 200, 100001},
			{strings.Replace(valid, `"action"`, `"unknown"`, 1), nil, 200, 100001}, {valid + ` {}`, nil, 200, 100001}, {valid + ` broken`, nil, 200, 100001},
			{strings.TrimSuffix(valid, "}") + `,"action":null}`, nil, 200, 100001},
			{strings.TrimSuffix(valid, "}") + `,"ids":[null]}`, nil, 200, 100001},
			{valid, shortlink.ErrInvalidInput, 200, 100001}, {valid, shortlink.ErrPermissionDenied, 200, 120001}, {valid, shortlink.ErrShortLinkMissing, 200, shortlink.CodeShortLinkMissing}, {valid, errors.New("database unavailable"), 500, 900000},
		} {
			t.Run(fmt.Sprintf("%s/%s/%d", path, test.body, test.code), func(t *testing.T) {
				stub := &batchStub{err: test.err}
				user := auth.CurrentUser{ID: "actor", Username: "actor", GroupKey: "user"}
				router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatch: stub, CurrentUser: &fakeCurrentUserResolver{user: user}})
				req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(test.body))
				req.Header.Set("Content-Type", "application/json")
				req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
				res := httptest.NewRecorder()
				router.ServeHTTP(res, req)
				payload := append([]byte(nil), res.Body.Bytes()...)
				assertBusinessCode(t, res, test.status, test.code)
				require.Contains(t, res.Header().Get("Cache-Control"), "no-store")
				if test.code == 0 {
					require.True(t, stub.called)
					require.Equal(t, admin, stub.admin)
					require.Equal(t, user, stub.user)
					require.Equal(t, "disable", stub.input.Action)
					var body struct {
						Data shortlink.BatchResult `json:"data"`
					}
					require.NoError(t, json.Unmarshal(payload, &body))
					require.Equal(t, int64(1), body.Data.AffectedCount)
				} else if test.err == nil {
					require.False(t, stub.called)
				}
			})
		}
	}
}

// TestBatchHTTPRequiresJSONMediaType blocks simple cross-origin writes before service dispatch in both scopes.
func TestBatchHTTPRequiresJSONMediaType(t *testing.T) {
	for _, path := range []string{"/api/v1/short-link/batch", "/api/v1/admin/short-link/batch"} {
		for _, test := range []struct {
			name, contentType string
			accepted          bool
		}{
			{name: "missing"},
			{name: "plain text", contentType: "text/plain"},
			{name: "form", contentType: "application/x-www-form-urlencoded"},
			{name: "multipart", contentType: "multipart/form-data; boundary=batch"},
			{name: "malformed", contentType: "application/json; charset"},
			{name: "different subtype", contentType: "application/problem+json"},
			{name: "JSON", contentType: "application/json", accepted: true},
			{name: "JSON with charset", contentType: "application/json; charset=utf-8", accepted: true},
			{name: "case insensitive JSON", contentType: "Application/JSON", accepted: true},
		} {
			t.Run(path+"/"+test.name, func(t *testing.T) {
				stub := &batchStub{}
				user := auth.CurrentUser{ID: "actor", Username: "actor", GroupKey: "user"}
				router := apphttp.NewRouter(apphttp.Dependencies{ShortLinkBatch: stub, CurrentUser: &fakeCurrentUserResolver{user: user}})
				req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(`{"ids":["00000000-0000-0000-0000-000000000001"],"action":"delete"}`))
				if test.contentType != "" {
					req.Header.Set("Content-Type", test.contentType)
				}
				req.Header.Set("Origin", "https://evil.example.com")
				req.Header.Set("Sec-Fetch-Site", "same-site")
				req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
				res := httptest.NewRecorder()
				router.ServeHTTP(res, req)
				code := 100001
				if test.accepted {
					code = 0
				}
				assertBusinessCode(t, res, http.StatusOK, code)
				require.Contains(t, res.Header().Get("Cache-Control"), "no-store")
				require.Equal(t, test.accepted, stub.called)
				if test.accepted {
					require.Equal(t, user, stub.user)
					require.Equal(t, "delete", stub.input.Action)
					require.Equal(t, strings.Contains(path, "/admin/"), stub.admin)
				}
			})
		}
	}
}
