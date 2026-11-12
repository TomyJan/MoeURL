package insights_test

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// requestGlobalVisitExport exercises the production route, parser, identity and database authorization.
func requestGlobalVisitExport(t *testing.T, service *insights.Service, actor auth.CurrentUser, query string, status, code int) []byte {
	t.Helper()
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: identityResolver{actor}, GlobalVisitExport: service})
	request := httptest.NewRequest("GET", "/api/v1/admin/dashboard/visits/export"+query, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, status, response.Code, response.Body.String())
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var body struct {
		Code int
		Data json.RawMessage
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, code, body.Code, response.Body.String())
	if code != 0 {
		require.JSONEq(t, "null", string(body.Data))
	}
	return response.Body.Bytes()
}

// TestGlobalVisitExportHTTP catches permissive query parsing and wrong business status or capacity codes.
func TestGlobalVisitExportHTTP(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	require.Contains(t, string(requestGlobalVisitExport(t, service, admin, "", 200, 0)), "moeurl-site-visits-")
	requestGlobalVisitExport(t, service, owner, "", 200, 120001)
	requestGlobalVisitExport(t, service, auth.GuestUser(), "", 200, 120001)
	for _, bad := range []string{"pageSize=25", "cursor=x", "id=" + link, "owner=x", "deviceType=desktop", "countryCode=CN", "days=", "days=7&days=30", "days=%zz", "days=1", "days=07", "startDate=", "endDate=", "days=7&startDate=2026-01-01&endDate=2026-01-02", "startDate=2099-01-01&endDate=2099-01-01", "startDate=2026-01-02&endDate=2026-01-01", "startDate=2026-01-01", "startDate=2026-02-30&endDate=2026-03-01", "limit=1"} {
		requestGlobalVisitExport(t, service, admin, "?"+bad, 200, 100001)
	}
	_, err := pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),$1,'redirect_response_sent',$2 from generate_series(1,1001)`, link, today)
	require.NoError(t, err)
	requestGlobalVisitExport(t, service, admin, "", 200, 200120)
}

// TestGlobalVisitExportFailures catches transaction faults, canceled work and private diagnostics.
func TestGlobalVisitExportFailures(t *testing.T) {
	pool, _, _, admin, _, _ := fixture(t)
	for _, boundary := range []string{"begin ", "-- name: GetInsightActor", "-- name: GetUserGroupByKey", "-- name: GetInsightTime", "-- name: ExportGlobalInsightVisits", "commit"} {
		t.Run(boundary, func(t *testing.T) {
			faultPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, query string) context.Context {
				if strings.HasPrefix(query, boundary) {
					bad, cancel := context.WithCancel(ctx)
					cancel()
					return bad
				}
				return ctx
			}})
			requestGlobalVisitExport(t, insights.NewService(faultPool, permission.NewDatabaseService(faultPool)), admin, "", 500, 900000)
		})
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := insights.NewService(pool, permission.NewDatabaseService(pool)).ExportGlobalVisits(ctx, admin, insights.RangeInput{})
	require.Error(t, err)
	require.Empty(t, result.Content)
	var logs bytes.Buffer
	h := insights.NewGlobalVisitExportHandler(insights.NewService(pool, errorResolver{}), slog.New(slog.NewTextHandler(&logs, nil)))
	response := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/export?days=7", nil)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "private"})
	auth.CurrentUserMiddleware(identityResolver{admin})(http.HandlerFunc(h.Export)).ServeHTTP(response, r)
	require.Equal(t, 500, response.Code)
	require.NotContains(t, response.Body.String(), "resolver offline")
	require.NotContains(t, logs.String(), "resolver offline")
	require.NotContains(t, logs.String(), "private")
	h = insights.NewGlobalVisitExportHandler(insights.NewService(pool, errorResolver{}), nil)
	h.Export(httptest.NewRecorder(), httptest.NewRequest("GET", "/export?days=7", nil))
}

// TestGlobalVisitExportSnapshotAndNoMutation catches mixed snapshots and export side effects.
func TestGlobalVisitExportSnapshotAndNoMutation(t *testing.T) {
	for _, change := range []string{"insert", "transfer", "revoke"} {
		t.Run(change, func(t *testing.T) {
			pool, _, _, admin, link, today := fixture(t)
			visit(t, pool, uuid.NewString(), link, today, "", "")
			snapshot := func() string {
				var value string
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_array((select jsonb_agg(to_jsonb(s) order by id) from short_link s),(select jsonb_agg(to_jsonb(e) order by id) from short_link_event e),(select jsonb_agg(to_jsonb(a) order by id) from audit_log a),(select jsonb_agg(to_jsonb(u) order by id) from app_user u),(select jsonb_agg(to_jsonb(g) order by id) from user_group g))::text`).Scan(&value))
				return value
			}
			entered, release := make(chan struct{}), make(chan struct{})
			signal := sync.OnceFunc(func() { close(entered) })
			unblock := sync.OnceFunc(func() { close(release) })
			readPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, query string) context.Context {
				if strings.HasPrefix(query, "-- name: ExportGlobalInsightVisits") {
					signal()
					select {
					case <-release:
					case <-ctx.Done():
					}
				}
				return ctx
			}})
			t.Cleanup(unblock)
			service := insights.NewService(readPool, permission.NewDatabaseService(readPool))
			type outcome struct {
				result insights.VisitExport
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				r, e := service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{})
				done <- outcome{r, e}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("export query not reached")
			}
			switch change {
			case "insert":
				visit(t, pool, uuid.NewString(), link, today.Add(time.Second), "", "")
			case "transfer":
				_, err := pool.Exec(t.Context(), `update short_link set owner_id=$1,deleted_at=now() where id=$2`, admin.ID, link)
				require.NoError(t, err)
			case "revoke":
				_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-'statistics:export_visits' where key='admin'`)
				require.NoError(t, err)
			}
			before := snapshot()
			unblock()
			select {
			case out := <-done:
				require.NoError(t, out.err)
				require.Len(t, exportedCells(t, out.result), 2)
				require.Equal(t, link, exportedCells(t, out.result)[1][0])
			case <-time.After(3 * time.Second):
				t.Fatal("export did not finish")
			}
			require.Equal(t, before, snapshot())
			result, err := service.ExportGlobalVisits(t.Context(), admin, insights.RangeInput{})
			if change == "revoke" {
				require.ErrorIs(t, err, insights.ErrPermissionDenied)
				require.Empty(t, result.Content)
			} else {
				require.NoError(t, err)
				want := 2
				if change == "insert" {
					want = 3
				}
				require.Len(t, exportedCells(t, result), want)
			}
		})
	}
}
