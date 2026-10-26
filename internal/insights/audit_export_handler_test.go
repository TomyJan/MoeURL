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
	"github.com/stretchr/testify/require"
)

// TestAuditExportFailures rejects failed snapshots without partial content or sensitive diagnostics.
func TestAuditExportFailures(t *testing.T) {
	pool, _, _, admin, _, _ := fixture(t)
	for _, boundary := range []string{"begin ", "-- name: GetInsightActor", "-- name: GetUserGroupByKey", "-- name: GetInsightTime", "-- name: ExportAuditLogs", "commit"} {
		t.Run(boundary, func(t *testing.T) {
			faultPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
				if strings.HasPrefix(sql, boundary) {
					bad, cancel := context.WithCancel(ctx)
					cancel()
					return bad
				}
				return ctx
			}})
			result, err := auditExporter(t, insights.NewService(faultPool, permission.NewDatabaseService(faultPool))).ExportAudit(t.Context(), admin, insights.AuditExportInput{})
			require.Error(t, err)
			require.Empty(t, result.Content)
		})
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	result, err := auditExporter(t, insights.NewService(pool, permission.NewDatabaseService(pool))).ExportAudit(ctx, admin, insights.AuditExportInput{})
	require.Error(t, err)
	require.Empty(t, result.Content)
}

// TestAuditExportSnapshotAndNoMutation catches mixed authorization times and accidental writes.
func TestAuditExportSnapshotAndNoMutation(t *testing.T) {
	for _, change := range []string{"insert", "revoke", "rename"} {
		t.Run(change, func(t *testing.T) {
			pool, _, owner, admin, _, today := fixture(t)
			_, err := pool.Exec(t.Context(), `insert into audit_log(actor_id,resource_type,resource_id,action,changed_fields,created_at) values($1,'user','first','update','{}',$2)`, owner.ID, today)
			require.NoError(t, err)
			entered, release := make(chan struct{}), make(chan struct{})
			signal := sync.OnceFunc(func() { close(entered) })
			unblock := sync.OnceFunc(func() { close(release) })
			readPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
				if strings.HasPrefix(sql, "-- name: ExportAuditLogs") {
					signal()
					select {
					case <-release:
					case <-ctx.Done():
					}
				}
				return ctx
			}})
			t.Cleanup(unblock)
			service := auditExporter(t, insights.NewService(readPool, permission.NewDatabaseService(readPool)))
			type outcome struct {
				result insights.AuditExport
				err    error
			}
			done := make(chan outcome, 1)
			go func() {
				r, e := service.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
				done <- outcome{r, e}
			}()
			select {
			case <-entered:
			case <-time.After(3 * time.Second):
				t.Fatal("snapshot boundary not reached")
			}
			switch change {
			case "insert":
				_, err = pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) values('user','second','update','{}',$1)`, today)
			case "revoke":
				_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'audit:export' where key='admin'`)
			case "rename":
				_, err = pool.Exec(t.Context(), `update app_user set username='renamed' where id=$1`, owner.ID)
			}
			require.NoError(t, err)
			snapshot := func() string {
				var value string
				require.NoError(t, pool.QueryRow(t.Context(), `select jsonb_build_array((select jsonb_agg(to_jsonb(a) order by id) from audit_log a),(select jsonb_agg(to_jsonb(u) order by id) from app_user u),(select jsonb_agg(to_jsonb(g) order by id) from user_group g),(select jsonb_agg(to_jsonb(s) order by id) from short_link s))::text`).Scan(&value))
				return value
			}
			before := snapshot()
			unblock()
			select {
			case out := <-done:
				require.NoError(t, out.err)
				rows := auditCells(t, out.result)
				require.Len(t, rows, 2)
				require.Equal(t, "owner", rows[1][6])
			case <-time.After(3 * time.Second):
				t.Fatal("export did not finish")
			}
			require.Equal(t, before, snapshot())
			r, e := service.ExportAudit(t.Context(), admin, insights.AuditExportInput{})
			if change == "revoke" {
				require.ErrorIs(t, e, insights.ErrPermissionDenied)
			} else {
				require.NoError(t, e)
				rows := auditCells(t, r)
				if change == "insert" {
					require.Len(t, rows, 3)
				} else {
					require.Equal(t, "renamed", rows[1][6])
				}
			}
		})
	}
}

// auditRequest checks the public envelope and caching boundary through real router registration.
func auditRequest(t *testing.T, service *insights.Service, actor auth.CurrentUser, query string, status, code int) []byte {
	t.Helper()
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: identityResolver{actor}, AuditExport: service})
	r := httptest.NewRequest("GET", "/api/v1/admin/audit/export?"+query, nil)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	require.Equal(t, status, w.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var body struct {
		Code int
		Data any
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
	require.Equal(t, code, body.Code, w.Body.String())
	if code != 0 {
		require.Nil(t, body.Data)
	}
	return w.Body.Bytes()
}

// TestAuditExportHTTP checks wire parsing, business codes and safe logs.
func TestAuditExportHTTP(t *testing.T) {
	pool, service, owner, admin, _, today := fixture(t)
	require.Contains(t, string(auditRequest(t, service, admin, "", 200, 0)), "moeurl-audit-")
	for _, bad := range []string{"cursor=x", "pageSize=1", "unknown=x", "days=", "days=7&days=7", "days=%zz", "days=1", "actorId=", "actorId=bad", "actorId=00000000-0000-0000-0000-000000000000", "resourceType=session", "action=login", "startDate=2026-02-30&endDate=2026-03-01", "days=7&startDate=2026-01-01&endDate=2026-01-02", "startDate=2026-01-01", "startDate=2026-01-02&endDate=2026-01-01", "startDate=2026-01-01&endDate=2026-04-01", "startDate=2099-01-01&endDate=2099-01-01"} {
		auditRequest(t, service, admin, bad, 200, 100001)
	}
	auditRequest(t, service, owner, "", 200, 120001)
	_, err := pool.Exec(t.Context(), `insert into audit_log(resource_type,resource_id,action,changed_fields,created_at) select 'user','bulk','update','{}',$1 from generate_series(1,1001)`, today)
	require.NoError(t, err)
	auditRequest(t, service, admin, "", 200, 100002)
	var logs bytes.Buffer
	h := insights.NewAuditExportHandler(insights.NewService(pool, errorResolver{}), slog.New(slog.NewTextHandler(&logs, nil)))
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/export?actorId="+owner.ID, nil)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "private"})
	auth.CurrentUserMiddleware(identityResolver{admin})(http.HandlerFunc(h.Export)).ServeHTTP(w, r)
	require.Equal(t, 500, w.Code)
	require.Contains(t, w.Body.String(), "900000")
	for _, s := range []string{"resolver offline", owner.ID, "private", "SQLSTATE", "csv"} {
		require.NotContains(t, logs.String(), s)
		require.NotContains(t, w.Body.String(), s)
	}
	insights.NewAuditExportHandler(insights.NewService(nil, nil), nil).Export(httptest.NewRecorder(), httptest.NewRequest("GET", "/export", nil))
}

// TestAuditExportInvalidQueryNeverInvokesPort catches accepting pagination or normalizing malformed filters.
func TestAuditExportInvalidQueryNeverInvokesPort(t *testing.T) {
	h := insights.NewAuditExportHandler(nil, nil)
	for _, query := range []string{"cursor=x", "pageSize=1", "unknown=x", "days=", "days=7&days=7", "days=%zz", "days=1", "actorId=", "actorId=bad", "actorId=00000000-0000-0000-0000-000000000000", "resourceType=session", "action=login", "resourceType=", "action=", "action=create&action=update", "actorId=00000000-0000-0000-0000-000000000001&actorId=00000000-0000-0000-0000-000000000001", "startDate=2026-02-30&endDate=2026-03-01", "days=7&startDate=2026-01-01&endDate=2026-01-02", "startDate=2026-01-01", "startDate=2026-01-02&endDate=2026-01-01", "startDate=2026-01-01&endDate=2026-04-01"} {
		t.Run(query, func(t *testing.T) {
			w := httptest.NewRecorder()
			// A call into the absent port would panic rather than returning this safe envelope.
			h.Export(w, httptest.NewRequest("GET", "/export?"+query, nil))
			require.Equal(t, 200, w.Code)
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			var body struct {
				Code int
				Data any
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
			require.Equal(t, 100001, body.Code)
			require.Nil(t, body.Data)
		})
	}
}
