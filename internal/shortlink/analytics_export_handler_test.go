package shortlink_test

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/stretchr/testify/require"
)

type exportStub struct {
	input  shortlink.StatisticsInput
	user   auth.CurrentUser
	admin  bool
	called bool
	err    error
}

// ExportStatistics captures HTTP dispatch without implementing the unrelated short-link Port.
func (s *exportStub) ExportStatistics(_ context.Context, user auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsExport, error) {
	s.input, s.user, s.called = input, user, true
	return shortlink.StatisticsExport{FileName: "moeurl-statistics-a1-2026-01-01-2026-01-02.csv", ContentType: "text/csv;charset=utf-8", Content: "\ufeffsection,key,value,visit_count\r\n"}, s.err
}

// AdminExportStatistics records administrative dispatch through the independent export port.
func (s *exportStub) AdminExportStatistics(ctx context.Context, user auth.CurrentUser, input shortlink.StatisticsInput) (shortlink.StatisticsExport, error) {
	s.admin = true
	return s.ExportStatistics(ctx, user, input)
}

// TestExportHTTP verifies independent dependency registration, strict input, envelopes and cache protection.
func TestExportHTTP(t *testing.T) {
	require.NotNil(t, shortlink.NewExportHandler(&exportStub{}, nil))
	for _, admin := range []bool{false, true} {
		path := "/api/v1/short-link/statistics/export"
		if admin {
			path = "/api/v1/admin/short-link/statistics/export"
		}
		for _, test := range []struct {
			name, query  string
			err          error
			status, code int
		}{
			{"success", "id=link&startDate=2026-01-01&endDate=2026-01-02", nil, 200, 0},
			{"days", "id=link&days=30", nil, 200, 0},
			{"default", "id=link", nil, 200, 0},
			{"empty", "id=link&days=", nil, 200, 100001},
			{"repeat", "id=link&days=7&days=30", nil, 200, 100001},
			{"repeat start", "id=link&startDate=one&startDate=two", nil, 200, 100001},
			{"repeat end", "id=link&endDate=one&endDate=two", nil, 200, 100001},
			{"malformed encoding", "id=link&days=%zz", nil, 200, 100001},
			{"permission", "id=link", shortlink.ErrPermissionDenied, 200, 120001},
			{"invalid", "id=link", shortlink.ErrInvalidInput, 200, 100001},
			{"missing", "id=link", shortlink.ErrShortLinkMissing, 200, shortlink.CodeShortLinkMissing},
			{"system", "id=link", errors.New("unavailable"), 500, 900000},
		} {
			t.Run(path+"/"+test.name, func(t *testing.T) {
				stub := &exportStub{err: test.err}
				user := auth.CurrentUser{ID: "actor", Username: "actor", GroupKey: "user"}
				router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: &fakeCurrentUserResolver{user: user}, ShortLinkExport: stub})
				request := httptest.NewRequest(http.MethodGet, path+"?"+test.query, nil)
				request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
				response := httptest.NewRecorder()
				router.ServeHTTP(response, request)
				payload := append([]byte(nil), response.Body.Bytes()...)
				assertBusinessCode(t, response, test.status, test.code)
				require.Contains(t, response.Header().Get("Cache-Control"), "no-store")
				if test.code == 0 {
					require.True(t, stub.called)
					require.Equal(t, admin, stub.admin)
					require.Equal(t, "actor", stub.user.ID)
					require.Equal(t, "link", stub.input.ID)
					if test.name == "days" {
						require.Equal(t, "30", stub.input.Days)
					}
					if test.name == "success" {
						require.Equal(t, "2026-01-01", stub.input.StartDate)
						require.Equal(t, "2026-01-02", stub.input.EndDate)
					}
					var body struct {
						Data shortlink.StatisticsExport `json:"data"`
					}
					require.NoError(t, json.Unmarshal(payload, &body))
					require.Equal(t, "text/csv;charset=utf-8", body.Data.ContentType)
					_, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(body.Data.Content, "\ufeff"))).ReadAll()
					require.NoError(t, err)
				} else if test.err == nil {
					require.False(t, stub.called)
				}
			})
		}
	}
}
