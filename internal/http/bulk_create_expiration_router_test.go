package http_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const expirationEndpoint = "/api/v1/short-link/batch-create-with-expirations"
const expirationRow = `{"targetUrl":"https://example.org/expiration75","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate","expiresAt":"2099-01-01T00:00:00Z"}`

// newExpirationRouterFixture exercises actual sessions, permission storage and all six production routes.
func newExpirationRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration"]' where key='user'`)
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000007504','guest','Guest','[]',true,now(),now())`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(f.pool, time.Hour).Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(f.pool, time.Hour), ShortLinkBatchCreate: svc, ShortLinkBatchCreateTitles: svc, ShortLinkBatchCreateMetadata: svc, ShortLinkBatchCreateCustomSlugs: svc, ShortLinkBatchCreateRedirectModes: svc, ShortLinkBatchCreateExpirations: svc})
	f.post = func(path, payload, expected string, authenticated bool) (int, int) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if expected != "" {
			r.Header.Set("X-MoeURL-Expected-User-ID", expected)
		}
		if authenticated {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, http.StatusOK, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				CreatedCount int `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		return body.Code, body.Data.CreatedCount
	}
	return f
}

// TestBulkExpirationProtocol catches missing, ambiguous and oversized data before any mutation.
func TestBulkExpirationProtocol(t *testing.T) {
	f := newExpirationRouterFixture(t)
	for name, invalid := range map[string]string{
		"missing expiry":     strings.Replace(expirationRow, `,"expiresAt":"2099-01-01T00:00:00Z"`, "", 1),
		"null expiry":        strings.Replace(expirationRow, `"2099-01-01T00:00:00Z"`, `null`, 1),
		"number expiry":      strings.Replace(expirationRow, `"2099-01-01T00:00:00Z"`, `1`, 1),
		"duplicate expiry":   strings.Replace(expirationRow, `"expiresAt":`, `"expiresAt":"","expiresAt":`, 1),
		"unknown field":      strings.Replace(expirationRow, `"expiresAt":`, `"delay":7,"expiresAt":`, 1),
		"missing mode":       strings.Replace(expirationRow, `,"redirectMode":"intermediate"`, "", 1),
		"missing title":      strings.Replace(expirationRow, `,"title":" raw "`, "", 1),
		"null title":         strings.Replace(expirationRow, `" raw "`, `null`, 1),
		"null target":        strings.Replace(expirationRow, `"https://example.org/expiration75"`, `null`, 1),
		"null tags":          strings.Replace(expirationRow, `[" tag "]`, `null`, 1),
		"null tag":           strings.Replace(expirationRow, `[" tag "]`, `[null]`, 1),
		"object tag":         strings.Replace(expirationRow, `[" tag "]`, `[{}]`, 1),
		"eleven tags":        strings.Replace(expirationRow, `[" tag "]`, `["1","2","3","4","5","6","7","8","9","10","11"]`, 1),
		"duplicate tags":     strings.Replace(expirationRow, `"tags":`, `"tags":[],"tags":`, 1),
		"unpaired surrogate": strings.Replace(expirationRow, `" raw "`, `"\ud800"`, 1),
		"invalid UTF8":       strings.Replace(expirationRow, `" raw "`, "\""+string([]byte{0xff})+"\"", 1),
	} {
		t.Run(name, func(t *testing.T) {
			before := redirectModeSnapshot(t, f)
			code, _ := f.post(expirationEndpoint, customSlugBody(uuid.NewString(), invalid), metadataRouterActor, true)
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
	for _, n := range []int{0, 20, 21} {
		rows := make([]string, n)
		for i := range n {
			rows[i] = strings.Replace(expirationRow, "expiration75", fmt.Sprintf("expiration75-%d", i), 1)
		}
		before := redirectModeSnapshot(t, f)
		code, count := f.post(expirationEndpoint, customSlugBody(uuid.NewString(), strings.Join(rows, ",")), metadataRouterActor, true)
		if n == 20 {
			require.Zero(t, code)
			require.Equal(t, 20, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, n := range []int{65536, 65537} {
		body := customSlugBody(uuid.NewString(), expirationRow)
		body += strings.Repeat(" ", n-len(body))
		before := redirectModeSnapshot(t, f)
		code, count := f.post(expirationEndpoint, body, metadataRouterActor, true)
		if n == 65536 {
			require.Zero(t, code)
			require.Equal(t, 1, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, invalid := range []string{`null`, `[]`, `{}`, customSlugBody(uuid.NewString(), expirationRow) + `{}`, customSlugBody(uuid.NewString(), expirationRow+","+expirationRow), strings.Replace(customSlugBody(uuid.NewString(), expirationRow), `"items":`, `"items":[],"items":`, 1)} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(expirationEndpoint, invalid, metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, authenticated := range []bool{false, true} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(expirationEndpoint, customSlugBody(uuid.NewString(), expirationRow), "stale", authenticated)
		require.Equal(t, 120001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
}

// expirationDeadline uses the database clock and leaves enough time for a local request to start.
func expirationDeadline(t *testing.T, f metadataRouterFixture) time.Time {
	t.Helper()
	var expiry time.Time
	require.NoError(t, f.pool.QueryRow(t.Context(), `select date_trunc('second',clock_timestamp())+interval '2 seconds'`).Scan(&expiry))
	return expiry.UTC()
}

// waitExpirationDeadline synchronizes with the actual authority instead of sleeping a guessed duration.
func waitExpirationDeadline(t *testing.T, f metadataRouterFixture, expiry time.Time) {
	t.Helper()
	require.Eventually(t, func() bool {
		var passed bool
		err := f.pool.QueryRow(t.Context(), `select clock_timestamp()>=$1::timestamptz`, expiry).Scan(&passed)
		return err == nil && passed
	}, 4*time.Second, 5*time.Millisecond)
}

// TestBulkExpirationReplayAfterDeadline catches future checks before receipts and duplicate quota consumption.
func TestBulkExpirationReplayAfterDeadline(t *testing.T) {
	f := newExpirationRouterFixture(t)
	expiry := expirationDeadline(t, f)
	row := strings.Replace(expirationRow, "2099-01-01T00:00:00Z", expiry.Format(time.RFC3339), 1)
	body := customSlugBody(uuid.NewString(), row)
	code, count := f.post(expirationEndpoint, body, metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 1, count)
	before := redirectModeSnapshot(t, f)
	waitExpirationDeadline(t, f, expiry)
	code, count = f.post(expirationEndpoint, body, metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 1, count)
	require.Equal(t, before, redirectModeSnapshot(t, f))
	code, _ = f.post(expirationEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
	require.Equal(t, 200108, code)
	require.Equal(t, before, redirectModeSnapshot(t, f))
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_expiration' where key='user'`)
	require.NoError(t, err)
	code, _ = f.post(expirationEndpoint, body, metadataRouterActor, true)
	require.Equal(t, 120001, code)
	require.Equal(t, before, redirectModeSnapshot(t, f))
	blank := strings.Replace(row, expiry.Format(time.RFC3339), "", 1)
	code, count = f.post(expirationEndpoint, customSlugBody(uuid.NewString(), blank), metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 1, count)
}

// TestBulkExpirationLockDeadline detects transaction-start or host time used after an actual lock wait.
func TestBulkExpirationLockDeadline(t *testing.T) {
	f := newExpirationRouterFixture(t)
	tx, err := f.pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
	require.NoError(t, err)
	expiry := expirationDeadline(t, f)
	var input shortlink.BatchCreateWithExpirationsInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), strings.Replace(expirationRow, "2099-01-01T00:00:00Z", expiry.Format(time.RFC3339), 1))), &input))
	before := redirectModeSnapshot(t, f)
	done := make(chan error, 1)
	go func() {
		_, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithExpirations(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := f.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, time.Second, 5*time.Millisecond)
	waitExpirationDeadline(t, f, expiry)
	require.NoError(t, tx.Commit(t.Context()))
	select {
	case err := <-done:
		require.ErrorIs(t, err, shortlink.ErrInvalidExpiration)
	case <-time.After(6 * time.Second):
		t.Fatal("deadline write did not settle")
	}
	require.Equal(t, before, redirectModeSnapshot(t, f))
}

// TestBulkExpirationLockedRevocation catches stale actor, group or expiration grants on writes and replay.
func TestBulkExpirationLockedRevocation(t *testing.T) {
	for _, replay := range []bool{false, true} {
		for _, fault := range []string{
			`update user_group set permissions=permissions-'short_link:set_expiration' where key='user'`,
			`update app_user set status='disabled' where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set deleted_at=now() where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set group_id=(select id from user_group where key='guest') where id='00000000-0000-0000-0000-000000005501'`,
		} {
			t.Run(fmt.Sprintf("replay=%t/%s", replay, fault), func(t *testing.T) {
				f := newExpirationRouterFixture(t)
				var input shortlink.BatchCreateWithExpirationsInput
				require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), expirationRow)), &input))
				svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
				actor := auth.CurrentUser{ID: metadataRouterActor}
				if replay {
					_, err := svc.BatchCreateWithExpirations(t.Context(), actor, input)
					require.NoError(t, err)
				}
				before := redirectModeSnapshot(t, f)
				tx, err := f.pool.Begin(t.Context())
				require.NoError(t, err)
				defer func() { _ = tx.Rollback(context.Background()) }()
				_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
				require.NoError(t, err)
				done := make(chan error, 1)
				go func() { _, err := svc.BatchCreateWithExpirations(t.Context(), actor, input); done <- err }()
				require.Eventually(t, func() bool {
					var waiting bool
					err := f.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
					return err == nil && waiting
				}, time.Second, 5*time.Millisecond)
				_, err = tx.Exec(t.Context(), fault)
				require.NoError(t, err)
				require.NoError(t, tx.Commit(t.Context()))
				select {
				case err := <-done:
					require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
				case <-time.After(6 * time.Second):
					t.Fatal("revoked write did not settle")
				}
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}
