package insights_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/event"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/insights"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type identityResolver struct{ user auth.CurrentUser }

// ResolveCurrentUser supplies a previously authenticated identity; the service must still recheck it.
func (r identityResolver) ResolveCurrentUser(context.Context, string) (auth.CurrentUser, error) {
	return r.user, nil
}

// requestInsight exercises the real router, middleware, query parser, service and SQLC reads.
func requestInsight(t *testing.T, service *insights.Service, user auth.CurrentUser, path string, status, code int) []byte {
	t.Helper()
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: identityResolver{user}, Insights: service, Audit: service})
	request := httptest.NewRequest("GET", path, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "insight-session"})
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	require.Equal(t, status, response.Code, response.Body.String())
	require.Equal(t, "no-store", response.Header().Get("Cache-Control"))
	var body struct {
		Code int `json:"code"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Equal(t, code, body.Code, response.Body.String())
	return response.Body.Bytes()
}

// TestInsightHTTPScopes validates each public API envelope and rejects ambiguous input before reads.
func TestInsightHTTPScopes(t *testing.T) {
	pool, service, owner, admin, link, today := fixture(t)
	visit(t, pool, uuid.NewString(), link, today, "mobile", "US")
	for _, row := range []struct {
		user auth.CurrentUser
		path string
	}{
		{admin, "/api/v1/admin/dashboard"}, {owner, "/api/v1/short-link/visits?id=" + link}, {admin, "/api/v1/admin/short-link/visits?id=" + link},
	} {
		data := requestInsight(t, service, row.user, row.path, 200, 0)
		require.NotContains(t, string(data), "target.example/private")
	}
	requestInsight(t, service, owner, "/api/v1/admin/dashboard", 200, 120001)
	requestInsight(t, service, admin, "/api/v1/short-link/visits?id="+link, 200, 200104)
	for _, path := range []string{"/api/v1/admin/dashboard?days=", "/api/v1/admin/dashboard?days=7&days=30", "/api/v1/admin/dashboard?days=07", "/api/v1/admin/dashboard?days=7&startDate=2026-01-01&endDate=2026-01-02", "/api/v1/short-link/visits?id=" + link + "&cursor=", "/api/v1/admin/short-link/visits?id=" + link + "&pageSize=0", "/api/v1/short-link/visits?id=" + link + "&countryCode=us", "/api/v1/admin/short-link/visits?id=" + link + "&deviceType=Desktop"} {
		requestInsight(t, service, admin, path, 200, 100001)
	}
	_, err := pool.Exec(t.Context(), `update user_group set permissions='{}'::jsonb where key='admin'`)
	require.NoError(t, err)
	requestInsight(t, service, admin, "/api/v1/admin/dashboard", 500, 900000)
}

type queryTracer struct {
	start func(context.Context, string) context.Context
}

// TraceQueryStart controls an actual database request at a named boundary.
func (t queryTracer) TraceQueryStart(ctx context.Context, _ *pgx.Conn, data pgx.TraceQueryStartData) context.Context {
	return t.start(ctx, data.SQL)
}
func (queryTracer) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// tracedPool shares only the test database; connection configuration and lifecycle stay isolated.
func tracedPool(t *testing.T, pool *pgxpool.Pool, tracer queryTracer) *pgxpool.Pool {
	t.Helper()
	config := pool.Config()
	config.ConnConfig.Tracer = tracer
	result, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	t.Cleanup(result.Close)
	return result
}

// TestInsightInfrastructureFailures prevents query failures from becoming false zero-count successes.
func TestInsightInfrastructureFailures(t *testing.T) {
	pool, _, owner, admin, link, _ := fixture(t)
	for _, test := range []struct {
		query, path string
		user        auth.CurrentUser
	}{
		{"begin ", "/api/v1/admin/dashboard", admin},
		{"-- name: GetInsightActor", "/api/v1/admin/dashboard", admin},
		{"-- name: GetUserGroupByKey", "/api/v1/admin/dashboard", admin},
		{"-- name: GetInsightTime", "/api/v1/admin/dashboard", admin},
		{"-- name: GetDashboardSummary", "/api/v1/admin/dashboard", admin},
		{"-- name: ListDashboardTrend", "/api/v1/admin/dashboard", admin},
		{"-- name: ListDashboardTopLinks", "/api/v1/admin/dashboard", admin},
		{"-- name: GetInsightLink", "/api/v1/short-link/visits?id=" + link, owner},
		{"-- name: ListInsightVisits", "/api/v1/short-link/visits?id=" + link, owner},
		{"commit", "/api/v1/admin/short-link/visits?id=" + link, admin},
	} {
		t.Run(test.query, func(t *testing.T) {
			faultPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
				if strings.HasPrefix(sql, test.query) {
					cancelled, cancel := context.WithCancel(ctx)
					cancel()
					return cancelled
				}
				return ctx
			}})
			service := insights.NewService(faultPool, permission.NewDatabaseService(faultPool))
			requestInsight(t, service, test.user, test.path, 500, 900000)
		})
	}
}

// TestDashboardConcurrentSnapshot catches mixed authorization, counters and range snapshots.
func TestDashboardConcurrentSnapshot(t *testing.T) {
	pool, _, owner, admin, link, today := fixture(t)
	entered, release := make(chan struct{}), make(chan struct{})
	releaseOnce := sync.OnceFunc(func() { close(release) })
	t.Cleanup(releaseOnce)
	blockOnce := sync.OnceFunc(func() { close(entered); <-release })
	readPool := tracedPool(t, pool, queryTracer{start: func(ctx context.Context, sql string) context.Context {
		if strings.HasPrefix(sql, "-- name: GetDashboardSummary") {
			blockOnce()
		}
		return ctx
	}})
	service := insights.NewService(readPool, permission.NewDatabaseService(readPool))
	type outcome struct {
		result insights.DashboardResult
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, err := service.Dashboard(t.Context(), admin, insights.RangeInput{})
		done <- outcome{result, err}
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("dashboard did not reach the controlled query boundary")
	}
	visit(t, pool, uuid.NewString(), link, today, "desktop", "")
	newLink(t, pool, owner.ID, "concurrent", false)
	_, err := pool.Exec(t.Context(), `update user_group set permissions=permissions-'statistics:read_all' where key='admin'`)
	require.NoError(t, err)
	releaseOnce()
	select {
	case result := <-done:
		require.NoError(t, result.err)
		require.Equal(t, int64(1), result.result.Summary.LinkCount)
		require.Zero(t, result.result.Summary.RangeVisitCount)
		require.Empty(t, result.result.TopLinks)
	case <-time.After(3 * time.Second):
		t.Fatal("dashboard did not finish")
	}
	_, err = service.Dashboard(t.Context(), admin, insights.RangeInput{})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
}

// TestInsightReadDeadlineAndDatabaseTimezone guards the request budget and UTC dates on non-UTC connections.
func TestInsightReadDeadlineAndDatabaseTimezone(t *testing.T) {
	pool, _, owner, admin, link, today := fixture(t)
	visit(t, pool, uuid.NewString(), link, today, "desktop", "US")
	var budget time.Duration
	config := pool.Config()
	config.ConnConfig.RuntimeParams["timezone"] = "America/Los_Angeles"
	config.ConnConfig.Tracer = queryTracer{start: func(ctx context.Context, sql string) context.Context {
		if strings.HasPrefix(sql, "-- name: GetInsightTime") {
			deadline, _ := ctx.Deadline()
			budget = time.Until(deadline)
		}
		return ctx
	}}
	zonePool, err := pgxpool.NewWithConfig(t.Context(), config)
	require.NoError(t, err)
	t.Cleanup(zonePool.Close)
	service := insights.NewService(zonePool, permission.NewDatabaseService(zonePool))
	result, err := service.Dashboard(t.Context(), admin, insights.RangeInput{})
	require.NoError(t, err)
	require.Greater(t, budget, time.Duration(0))
	require.LessOrEqual(t, budget, 5*time.Second)
	require.Equal(t, today.Format(time.DateOnly), result.Range.EndDate)
	require.Equal(t, int64(1), result.Summary.TodayVisitCount)
	visits, err := service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.NoError(t, err)
	require.Len(t, visits.Items, 1)
	require.Equal(t, today, visits.Items[0].OccurredAt)
}

type errorResolver struct{}

// Resolve models a resolver infrastructure outage independently of database identity availability.
func (errorResolver) Resolve(context.Context, string) (permission.Snapshot, error) {
	return permission.Snapshot{}, errors.New("resolver offline")
}

// TestInsightFallbackResolverCannotExpandDatabaseGrants checks both denial and outage propagation.
func TestInsightFallbackResolverCannotExpandDatabaseGrants(t *testing.T) {
	pool, _, owner, admin, link, today := fixture(t)
	service := insights.NewService(pool, permission.NewService())
	_, err := service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.NoError(t, err)
	_, err = service.Dashboard(t.Context(), admin, insights.RangeInput{StartDate: today.AddDate(0, 0, 1).Format(time.DateOnly), EndDate: today.AddDate(0, 0, 1).Format(time.DateOnly)})
	require.ErrorIs(t, err, insights.ErrInvalidInput)
	_, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link, Cursor: baseCursor(today.AddDate(0, 0, -10))})
	require.ErrorIs(t, err, insights.ErrInvalidInput)
	_, err = pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:read_visits' where key='user'`)
	require.NoError(t, err)
	_, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.ErrorIs(t, err, insights.ErrPermissionDenied)
	_, err = insights.NewService(pool, errorResolver{}).Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.EqualError(t, err, "resolver offline")
	// Standalone consumers may omit a logger; infrastructure responses must remain safe.
	handler := insights.NewHandler(insights.NewService(pool, errorResolver{}), nil)
	request := httptest.NewRequest("GET", "/visits?id="+link, nil)
	request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: "session"})
	response := httptest.NewRecorder()
	auth.CurrentUserMiddleware(identityResolver{owner})(http.HandlerFunc(handler.Visits)).ServeHTTP(response, request)
	require.Equal(t, 500, response.Code)
	require.NotContains(t, response.Body.String(), "resolver offline")
	_, err = pool.Exec(t.Context(), `update user_group set permissions='{}'::jsonb where key='user'`)
	require.NoError(t, err)
	_, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
	require.Error(t, err)
}

// baseCursor constructs wire data independently to exercise range-bound cursor rejection.
func baseCursor(at time.Time) string {
	return base64.RawURLEncoding.EncodeToString([]byte(`{"createdAt":"` + at.Format(time.RFC3339Nano) + `","id":"00000000-0000-0000-0000-000000000001"}`))
}

// TestAnonymousAgentPersistenceThroughRedirect catches lost handler fields and raw metadata leakage.
func TestAnonymousAgentPersistenceThroughRedirect(t *testing.T) {
	pool, service, owner, _, _, _ := fixture(t)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	recorder := event.NewRecorder(pool, logger)
	router := apphttp.NewRouter(apphttp.Dependencies{Logger: logger, Redirect: shortlink.NewRedirectService(pool, recorder), RedirectRecorder: recorder, AnalyticsCountryHeader: "X-Trusted-Country"})
	for i, test := range []struct{ agent, browser, os string }{
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", "chrome", "windows"},
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1", "safari", "ios"},
		{"Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "bot", ""},
		{"", "", ""}, {strings.Repeat("private-marker/1.0 ", 1000), "", ""},
	} {
		slug := fmt.Sprintf("agent%d", i)
		link := newLink(t, pool, owner.ID, slug, false)
		request := httptest.NewRequest("GET", "https://short.example/"+slug, nil)
		request.Header.Set("User-Agent", test.agent)
		request.Header.Set("Referer", "https://Search.Example/private?token=secret-marker")
		request.Header.Set("X-Trusted-Country", "us")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		require.Equal(t, 302, response.Code, response.Body.String())
		var result insights.VisitResult
		require.EventuallyWithT(t, func(collect *assert.CollectT) {
			var err error
			result, err = service.Visits(t.Context(), owner, insights.VisitInput{ID: link})
			assert.NoError(collect, err)
			assert.Len(collect, result.Items, 1)
		}, 3*time.Second, 10*time.Millisecond)
		record := result.Items[0]
		if test.browser == "" {
			require.Nil(t, record.BrowserFamily)
		} else {
			require.Equal(t, test.browser, *record.BrowserFamily)
		}
		if test.os == "" {
			require.Nil(t, record.OSFamily)
		} else {
			require.Equal(t, test.os, *record.OSFamily)
		}
		require.Equal(t, "search.example", *record.ReferrerHost)
		require.Equal(t, "US", *record.CountryCode)
		var persisted string
		require.NoError(t, pool.QueryRow(t.Context(), `select row_to_json(short_link_event)::text from short_link_event where short_link_id=$1`, link).Scan(&persisted))
		for _, secret := range []string{"Mozilla/", "120.0", "17_0", "private-marker", "secret-marker", "target.example/private"} {
			require.NotContains(t, persisted, secret)
		}
	}
}
