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

// requestVisitExport exercises real routing, strict wire parsing, identity middleware and SQL.
func requestVisitExport(t *testing.T, service *insights.Service, actor auth.CurrentUser, path string, status, code int) []byte {
	t.Helper()
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: identityResolver{actor}, VisitExport: service})
	request := httptest.NewRequest("GET", path, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, status, response.Code, response.Body.String())
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var body struct{ Code int }
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, code, body.Code, response.Body.String())
	return response.Body.Bytes()
}

// TestVisitExportHTTP catches unregistered routes, pagination acceptance and wrong business codes.
func TestVisitExportHTTP(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	for _, scope := range []struct {
		prefix string
		actor  auth.CurrentUser
	}{{"", owner}, {"/admin", admin}} {
		path := "/api/v1" + scope.prefix + "/short-link/visits/export?id=" + link
		require.Contains(t, string(requestVisitExport(t, service, scope.actor, path, 200, 0)), "fileName")
		for _, bad := range []string{"&pageSize=25", "&cursor=x", "&id=" + link, "&days=", "&deviceType=", "&countryCode=", "&owner=x", "&limit=1", "&fields=x", "&days=%zz", "&days=1", "&countryCode=us", "&deviceType=Desktop", "&days=7&startDate=2026-01-01&endDate=2026-01-02", "&startDate=2099-01-01&endDate=2099-01-01"} {
			requestVisitExport(t, service, scope.actor, path+bad, 200, 100001)
		}
	}
	requestVisitExport(t, service, admin, "/api/v1/short-link/visits/export?id="+link, 200, 200104)
	requestVisitExport(t, service, owner, "/api/v1/admin/short-link/visits/export?id="+link, 200, 120001)
	requestVisitExport(t, service, owner, "/api/v1/short-link/visits/export?id=bad", 200, 100001)
	_, err := pool.Exec(t.Context(), `insert into short_link_event(id,short_link_id,event_type,created_at) select gen_random_uuid(),$1,'redirect_response_sent',$2 from generate_series(1,1001)`, link, today)
	require.NoError(t, err)
	requestVisitExport(t, service, owner, "/api/v1/short-link/visits/export?id="+link, 200, 200120)
}

// TestVisitExportFailures catches partial-file success after transaction or query failure and unsafe diagnostics.
func TestVisitExportFailures(t *testing.T) {
	pool, _, owner, _, link, _ := fixture(t)
	for _, boundary := range []string{"begin ", "-- name: GetInsightActor", "-- name: GetUserGroupByKey", "-- name: GetInsightTime", "-- name: GetInsightLink", "-- name: ExportInsightVisits", "commit"} {
		t.Run(boundary, func(t *testing.T) {
			faultPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
				if strings.HasPrefix(sql, boundary) {
					bad, cancel := context.WithCancel(ctx)
					cancel()
					return bad
				}
				return ctx
			}})
			service := insights.NewService(faultPool, permission.NewDatabaseService(faultPool))
			requestVisitExport(t, service, owner, "/api/v1/short-link/visits/export?id="+link, 500, 900000)
		})
	}
	for _, expired := range []bool{false, true} {
		ctx, cancel := context.WithCancel(t.Context())
		if expired {
			cancel()
			ctx, cancel = context.WithDeadline(t.Context(), time.Now().Add(-time.Second))
		}
		cancel()
		result, err := insights.NewService(pool, permission.NewDatabaseService(pool)).ExportVisits(ctx, owner, insights.VisitExportInput{ID: link})
		require.Error(t, err)
		require.Empty(t, result.Content)
	}
	var logs bytes.Buffer
	h := insights.NewVisitExportHandler(insights.NewService(pool, errorResolver{}), slog.New(slog.NewTextHandler(&logs, nil)))
	response := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/export?id="+link, nil)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "private"})
	auth.CurrentUserMiddleware(identityResolver{owner})(http.HandlerFunc(h.ExportVisits)).ServeHTTP(response, r)
	require.Equal(t, 500, response.Code)
	require.NotContains(t, response.Body.String(), "resolver offline")
	require.NotContains(t, logs.String(), "resolver offline")
	require.NotContains(t, logs.String(), link)
	// Nil logger retains safe infrastructure responses for standalone consumers.
	h = insights.NewVisitExportHandler(insights.NewService(pool, errorResolver{}), nil)
	h.AdminExportVisits(httptest.NewRecorder(), httptest.NewRequest("GET", "/export?id="+link, nil))
}

// TestVisitExportSnapshotAndNoMutation catches mixing post-snapshot grants, ownership and events.
func TestVisitExportSnapshotAndNoMutation(t *testing.T) {
	for _, change := range []string{"insert", "transfer", "revoke"} {
		t.Run(change, func(t *testing.T) {
			pool, _, owner, admin, link, today := fixture(t)
			visit(t, pool, uuid.NewString(), link, today, "", "")
			snapshot := func() string {
				var value string
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_array((select jsonb_agg(to_jsonb(s) order by id) from short_link s),(select jsonb_agg(to_jsonb(e) order by id) from short_link_event e),(select jsonb_agg(to_jsonb(a) order by id) from audit_log a),(select jsonb_agg(to_jsonb(u) order by id) from app_user u),(select jsonb_agg(to_jsonb(g) order by id) from user_group g))::text`).Scan(&value))
				return value
			}
			entered, release := make(chan struct{}), make(chan struct{})
			signal := sync.OnceFunc(func() { close(entered) })
			unblock := sync.OnceFunc(func() { close(release) })
			readPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
				if strings.HasPrefix(sql, "-- name: ExportInsightVisits") {
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
				r, e := service.ExportVisits(t.Context(), owner, insights.VisitExportInput{ID: link})
				done <- outcome{r, e}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("export query boundary not reached")
			}
			switch change {
			case "insert":
				visit(t, pool, uuid.NewString(), link, today.Add(time.Second), "", "")
			case "transfer":
				_, e := pool.Exec(t.Context(), `update short_link set owner_id=$1 where id=$2`, admin.ID, link)
				require.NoError(t, e)
			case "revoke":
				_, e := pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:export_visits' where key='user'`)
				require.NoError(t, e)
			}
			before := snapshot()
			unblock()
			select {
			case out := <-done:
				require.NoError(t, out.err)
				require.Len(t, exportedCells(t, out.result), 2)
			case <-time.After(3 * time.Second):
				t.Fatal("export did not finish")
			}
			require.Equal(t, before, snapshot())
			result, err := service.ExportVisits(t.Context(), owner, insights.VisitExportInput{ID: link})
			switch change {
			case "insert":
				require.NoError(t, err)
				require.Len(t, exportedCells(t, result), 3)
			case "transfer":
				require.ErrorIs(t, err, insights.ErrLinkMissing)
			case "revoke":
				require.ErrorIs(t, err, insights.ErrPermissionDenied)
			}
		})
	}
}
