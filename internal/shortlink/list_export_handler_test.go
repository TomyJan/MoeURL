package shortlink_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type listExportStub struct {
	err           error
	input         shortlink.ListExportInput
	actor         auth.CurrentUser
	admin, called bool
}

// ExportList supplies a controlled infrastructure boundary for real HTTP response mapping.
func (s *listExportStub) ExportList(_ context.Context, actor auth.CurrentUser, input shortlink.ListExportInput) (shortlink.ListExport, error) {
	s.actor, s.input, s.called = actor, input, true
	return shortlink.ListExport{FileName: "moeurl-links-own.csv", ContentType: "text/csv;charset=utf-8", Content: "\ufeffid,short_url\r\n"}, s.err
}

// AdminExportList captures which authorization context is dispatched.
func (s *listExportStub) AdminExportList(ctx context.Context, actor auth.CurrentUser, input shortlink.ListExportInput) (shortlink.ListExport, error) {
	s.admin = true
	return s.ExportList(ctx, actor, input)
}

// TestListExportHTTP catches permissive query parsing, wrong dispatch and accidental success on failures.
func TestListExportHTTP(t *testing.T) {
	require.NotNil(t, shortlink.NewListExportHandler(&listExportStub{}, nil))
	for _, admin := range []bool{false, true} {
		path := "/api/v1/short-link/export"
		if admin {
			path = "/api/v1/admin/short-link/export"
		}
		for _, test := range []struct {
			name, query  string
			err          error
			status, code int
		}{
			{"empty", "", nil, 200, 0}, {"filters", "status=active&q=hello%25&tag=Case", nil, 200, 0},
			{"blank values", "status=&q=&tag=", nil, 200, 0},
			{"unknown", "query=hello", nil, 200, 100001}, {"page", "page=1", nil, 200, 100001},
			{"page size", "pageSize=20", nil, 200, 100001}, {"owner", "owner_id=x", nil, 200, 100001},
			{"repeat", "q=a&q=b", nil, 200, 100001}, {"repeat status", "status=&status=active", nil, 200, 100001},
			{"repeat tag", "tag=a&tag=b", nil, 200, 100001}, {"bare", "q", nil, 200, 100001},
			{"bad escape", "q=%zz", nil, 200, 100001}, {"semicolon", "q=a;b", nil, 200, 100001},
			{"empty segment", "q=a&&tag=b", nil, 200, 100001}, {"leading separator", "&q=a", nil, 200, 100001},
			{"permission", "", shortlink.ErrPermissionDenied, 200, 120001},
			{"invalid", "", shortlink.ErrInvalidInput, 200, 100001}, {"invalid status", "", shortlink.ErrInvalidStatus, 200, 100001},
			{"overlimit", "", shortlink.ErrListExportLimit, 200, 200118},
			{"system", "", errors.New("private upstream details"), 500, 900000},
		} {
			t.Run(path+test.name, func(t *testing.T) {
				stub := &listExportStub{err: test.err}
				actor := auth.CurrentUser{ID: "actor", Username: "actor", GroupKey: "user"}
				var logs bytes.Buffer
				router := apphttp.NewRouter(apphttp.Dependencies{Logger: slog.New(slog.NewJSONHandler(&logs, nil)), CurrentUser: &fakeCurrentUserResolver{user: actor}, ShortLinkListExport: stub})
				req := httptest.NewRequest(http.MethodGet, path+"?"+test.query, nil)
				req.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
				res := httptest.NewRecorder()
				router.ServeHTTP(res, req)
				payload := append([]byte(nil), res.Body.Bytes()...)
				assertBusinessCode(t, res, test.status, test.code)
				require.Equal(t, "no-store", res.Header().Get("Cache-Control"))
				require.NotContains(t, string(payload), "private upstream details")
				require.NotContains(t, logs.String(), "private upstream details")
				if test.code == 0 {
					var body struct {
						Data shortlink.ListExport `json:"data"`
					}
					require.NoError(t, json.Unmarshal(payload, &body))
					require.Equal(t, shortlink.ListExport{FileName: "moeurl-links-own.csv", ContentType: "text/csv;charset=utf-8", Content: "\ufeffid,short_url\r\n"}, body.Data)
					require.True(t, stub.called)
					require.Equal(t, admin, stub.admin)
					require.Equal(t, actor, stub.actor)
					if test.name == "filters" {
						require.Equal(t, shortlink.ListExportInput{Status: "active", Query: "hello%", Tag: "Case"}, stub.input)
					}
				} else if test.err == nil {
					require.False(t, stub.called)
				}
			})
		}
	}
}
