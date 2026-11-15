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

const countdownEndpoint = "/api/v1/short-link/batch-create-with-countdowns"
const countdownRow = `{"targetUrl":"https://example.org/delay77","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate","expiresAt":"2099-01-01T00:00:00Z","maxVisits":"1","intermediateDelaySeconds":"3"}`

// newCountdownRouterFixture exercises actual sessions, permission storage and all seven production routes.
func newCountdownRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration","short_link:set_max_visits"]' where key='user'`)
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000007504','guest','Guest','[]',true,now(),now())`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(f.pool, time.Hour).Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(f.pool, time.Hour), ShortLinkBatchCreate: svc, ShortLinkBatchCreateTitles: svc, ShortLinkBatchCreateMetadata: svc, ShortLinkBatchCreateCustomSlugs: svc, ShortLinkBatchCreateRedirectModes: svc, ShortLinkBatchCreateExpirations: svc, ShortLinkBatchCreateVisitLimits: svc, ShortLinkBatchCreateCountdowns: svc})
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

// TestBulkCountdownProtocol rejects lossy caps, ambiguous objects and both batch size boundaries without writes.
func TestBulkCountdownProtocol(t *testing.T) {
	f := newCountdownRouterFixture(t)
	for _, value := range []string{"2", "11", "0", "-1", "+3", "03", "3.0", "3e0", " ", " 3", "3 ", "３", "٣", "3\n", "\x00"} {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		row := strings.Replace(countdownRow, `"intermediateDelaySeconds":"3"`, `"intermediateDelaySeconds":`+string(encoded), 1)
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
		require.Equal(t, 100001, code, value)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, replacement := range []string{`"intermediateDelaySeconds":null`, `"intermediateDelaySeconds":3`, `"intermediateDelaySeconds":true`, `"intermediateDelaySeconds":[]`, `"intermediateDelaySeconds":{}`, `"intermediateDelaySeconds":"3","intermediateDelaySeconds":"10"`, `"IntermediateDelaySeconds":"3"`} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), strings.Replace(countdownRow, `"intermediateDelaySeconds":"3"`, replacement, 1)), metadataRouterActor, true)
		require.Equal(t, 100001, code, replacement)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, mode := range []string{"", "direct", "confirmation", "intermediate"} {
		for _, value := range []string{"", "3", "4", "5", "6", "7", "8", "9", "10"} {
			row := strings.Replace(strings.Replace(countdownRow, `"redirectMode":"intermediate"`, `"redirectMode":"`+mode+`"`, 1), `"intermediateDelaySeconds":"3"`, `"intermediateDelaySeconds":"`+value+`"`, 1)
			before := redirectModeSnapshot(t, f)
			code, count := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
			if value == "" || mode == "intermediate" {
				require.Zero(t, code)
				require.Equal(t, 1, count)
				want := map[string]int16{"": 5, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10}[value]
				var persisted int16
				require.NoError(t, f.pool.QueryRow(t.Context(), `select intermediate_delay_seconds from short_link where target_url='https://example.org/delay77' order by created_at desc limit 1`).Scan(&persisted))
				require.Equal(t, want, persisted)
			} else {
				require.Equal(t, 100001, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			}
		}
	}
	missing := strings.Replace(countdownRow, `,"intermediateDelaySeconds":"3"`, "", 1)
	beforeMissing := redirectModeSnapshot(t, f)
	codeMissing, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), missing), metadataRouterActor, true)
	require.Equal(t, 100001, codeMissing)
	require.Equal(t, beforeMissing, redirectModeSnapshot(t, f))
	for _, value := range []string{"0", "01", "+1", "-1", " ", " 1", "1 ", "1\n", "1.0", "1e1", "１", "١", "2147483648", "99999999999"} {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		row := strings.Replace(countdownRow, `"maxVisits":"1"`, `"maxVisits":`+string(encoded), 1)
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
		require.Equal(t, 100001, code, value)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, replacement := range []string{`"maxVisits":null`, `"maxVisits":1`, `"maxVisits":true`, `"maxVisits":[]`, `"maxVisits":{}`, `"maxVisits":"1","maxVisits":"2"`, `"unknown":"1"`} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), strings.Replace(countdownRow, `"maxVisits":"1"`, replacement, 1)), metadataRouterActor, true)
		require.Equal(t, 100001, code, replacement)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, invalid := range []string{
		strings.Replace(countdownRow, `,"maxVisits":"1"`, "", 1),
		strings.Replace(countdownRow, `" raw "`, `"\ud800"`, 1),
		strings.Replace(countdownRow, `" raw "`, "\""+string([]byte{0xff})+"\"", 1),
	} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), invalid), metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, n := range []int{0, 20, 21} {
		rows := make([]string, n)
		for i := range n {
			rows[i] = strings.Replace(countdownRow, "delay77", fmt.Sprintf("delay77-%d", i), 1)
		}
		before := redirectModeSnapshot(t, f)
		code, count := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), strings.Join(rows, ",")), metadataRouterActor, true)
		if n == 20 {
			require.Zero(t, code)
			require.Equal(t, 20, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, n := range []int{65536, 65537} {
		body := customSlugBody(uuid.NewString(), countdownRow)
		body += strings.Repeat(" ", n-len(body))
		before := redirectModeSnapshot(t, f)
		code, count := f.post(countdownEndpoint, body, metadataRouterActor, true)
		if n == 65536 {
			require.Zero(t, code)
			require.Equal(t, 1, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, invalid := range []string{`null`, `[]`, `{}`, customSlugBody(uuid.NewString(), countdownRow) + `{}`, customSlugBody(uuid.NewString(), countdownRow+","+countdownRow), strings.Replace(customSlugBody(uuid.NewString(), countdownRow), `"items":`, `"items":[],"items":`, 1)} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, invalid, metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, authenticated := range []bool{false, true} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), countdownRow), "stale", authenticated)
		require.Equal(t, 120001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
}

// TestBulkCountdownCurrentPermissionBeforeReplay rechecks every actual authority before returning an existing receipt.
func TestBulkCountdownCurrentPermissionBeforeReplay(t *testing.T) {
	f := newCountdownRouterFixture(t)
	body := customSlugBody(uuid.NewString(), countdownRow)
	code, _ := f.post(countdownEndpoint, body, metadataRouterActor, true)
	require.Zero(t, code)
	for _, grant := range []string{permission.ShortLinkCreate, permission.DomainUseDefault, permission.ShortLinkSetMetadata, permission.ShortLinkCustomSlug, permission.ShortLinkUseIntermediate, permission.ShortLinkSetExpiration, permission.ShortLinkSetMaxVisits} {
		_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='user'`, grant)
		require.NoError(t, err)
		before := redirectModeSnapshot(t, f)
		for _, payload := range []string{body, customSlugBody(uuid.NewString(), countdownRow)} {
			code, _ = f.post(countdownEndpoint, payload, metadataRouterActor, true)
			require.Equal(t, 120001, code, grant)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
		_, err = f.pool.Exec(t.Context(), `update user_group set permissions=permissions||jsonb_build_array($1::text) where key='user'`, grant)
		require.NoError(t, err)
		code, _ = f.post(countdownEndpoint, body, metadataRouterActor, true)
		require.Zero(t, code)
	}
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_max_visits'-'short_link:set_expiration' where key='user'`)
	require.NoError(t, err)
	blank := strings.ReplaceAll(strings.ReplaceAll(countdownRow, `"maxVisits":"1"`, `"maxVisits":""`), `"expiresAt":"2099-01-01T00:00:00Z"`, `"expiresAt":""`)
	code, count := f.post(countdownEndpoint, customSlugBody(uuid.NewString(), blank), metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 1, count)
}

// TestBulkCountdownLockedRevocation observes a real actor-lock wait before withdrawing authority for new writes and replay.
func TestBulkCountdownLockedRevocation(t *testing.T) {
	for _, replay := range []bool{false, true} {
		for _, fault := range []string{
			`update user_group set permissions=permissions-'short_link:set_max_visits' where key='user'`,
			`update user_group set permissions=permissions-'short_link:use_intermediate' where key='user'`,
			`update user_group set permissions=permissions-'short_link:set_expiration' where key='user'`,
			`update app_user set status='disabled' where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set deleted_at=now() where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set group_id=(select id from user_group where key='guest') where id='00000000-0000-0000-0000-000000005501'`,
		} {
			t.Run(fmt.Sprintf("replay=%t/%s", replay, fault), func(t *testing.T) {
				f := newCountdownRouterFixture(t)
				var input shortlink.BatchCreateWithCountdownsInput
				require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), countdownRow)), &input))
				svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
				actor := auth.CurrentUser{ID: metadataRouterActor}
				if replay {
					_, err := svc.BatchCreateWithCountdowns(t.Context(), actor, input)
					require.NoError(t, err)
				}
				before := redirectModeSnapshot(t, f)
				tx, err := f.pool.Begin(t.Context())
				require.NoError(t, err)
				defer func() { _ = tx.Rollback(context.Background()) }()
				_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
				require.NoError(t, err)
				done := make(chan error, 1)
				go func() { _, err := svc.BatchCreateWithCountdowns(t.Context(), actor, input); done <- err }()
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
					t.Fatal("revoked countdown write did not settle")
				}
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}

// TestBulkCountdownConcurrentReceipt requires one committed batch across competing identical keys or slugs.
func TestBulkCountdownConcurrentReceipt(t *testing.T) {
	for _, kind := range []string{"same key", "changed delay", "same slug"} {
		t.Run(kind, func(t *testing.T) {
			f := newCountdownRouterFixture(t)
			svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
			var first, second shortlink.BatchCreateWithCountdownsInput
			body := customSlugBody(uuid.NewString(), strings.Replace(countdownRow, `"customSlug":""`, `"customSlug":"Cap76"`, 1))
			require.NoError(t, json.Unmarshal([]byte(body), &first))
			require.NoError(t, json.Unmarshal([]byte(body), &second))
			if kind == "changed delay" {
				second.Items[0].IntermediateDelaySeconds = "10"
			}
			if kind == "same slug" {
				second.RequestID = uuid.NewString()
			}
			start, done := make(chan struct{}), make(chan error, 2)
			for _, input := range []shortlink.BatchCreateWithCountdownsInput{first, second} {
				go func() {
					<-start
					_, err := svc.BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
					done <- err
				}()
			}
			close(start)
			var success, conflict int
			for range 2 {
				select {
				case err := <-done:
					if err == nil {
						success++
					} else {
						conflict++
						if kind == "same slug" {
							require.ErrorIs(t, err, shortlink.ErrSlugConflict)
						} else {
							require.ErrorIs(t, err, shortlink.ErrBulkCreateConflict)
						}
					}
				case <-time.After(6 * time.Second):
					t.Fatal("concurrent countdown writes did not settle")
				}
			}
			if kind == "same key" {
				require.Equal(t, 2, success)
				require.Zero(t, conflict)
			} else {
				require.Equal(t, 1, success)
				require.Equal(t, 1, conflict)
			}
			require.Equal(t, []int{1, 1, 1}, f.counts())
		})
	}
}

// TestBulkCountdownAtomicity verifies complete stored state after failures in link, audit, receipt and quota writes.
func TestBulkCountdownAtomicity(t *testing.T) {
	for _, tc := range []struct{ name, setup string }{
		{"link", `create function fail_cap_link() returns trigger language plpgsql as $$ begin if NEW.target_url like '%last77' then raise exception 'owned last link failure'; end if; return NEW; end $$; create trigger fail_cap_link before insert on short_link for each row execute function fail_cap_link()`},
		{"audit", `create function fail_cap_audit() returns trigger language plpgsql as $$ begin raise exception 'owned audit failure'; end $$; create trigger fail_cap_audit before insert on audit_log for each row execute function fail_cap_audit()`},
		{"receipt", `create function fail_cap_receipt() returns trigger language plpgsql as $$ begin raise exception 'owned receipt failure'; end $$; create trigger fail_cap_receipt before insert on short_link_create_batch for each row execute function fail_cap_receipt()`},
		{"quota", `update system_setting set value='{"dailyLimit":1}' where key='security.account_daily_create_quota'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newCountdownRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), tc.setup)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			var input shortlink.BatchCreateWithCountdownsInput
			require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), countdownRow+","+strings.Replace(countdownRow, "delay77", "last77", 1))), &input))
			result, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithCountdowns(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
			require.Error(t, err)
			require.Zero(t, result)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkCountdownLegacyProtocols catches default-zero regressions and cross-protocol receipt aliasing in both directions.
func TestBulkCountdownLegacyProtocols(t *testing.T) {
	const key = "11111111-1111-4111-8111-111111117707"
	const seven = `{"targetUrl":"https://example.org/delay77","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate","expiresAt":"","maxVisits":"1"}`
	legacyRows := []struct{ path, row string }{
		{"/api/v1/short-link/batch-create", `"https://example.org/delay77"`},
		{"/api/v1/short-link/batch-create-with-titles", `{"targetUrl":"https://example.org/delay77","title":" raw "}`},
		{metadataRouterEndpoint, `{"targetUrl":"https://example.org/delay77","title":" raw ","tags":[" tag "]}`},
		{"/api/v1/short-link/batch-create-with-custom-slugs", `{"targetUrl":"https://example.org/delay77","title":" raw ","tags":[" tag "],"customSlug":""}`},
		{"/api/v1/short-link/batch-create-with-redirect-modes", `{"targetUrl":"https://example.org/delay77","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate"}`},
		{expirationEndpoint, strings.Replace(seven, `,"maxVisits":"1"`, "", 1)},
		{"/api/v1/short-link/batch-create-with-visit-limits", seven},
	}
	for _, legacy := range legacyRows {
		for _, newFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/newFirst=%t", legacy.path, newFirst), func(t *testing.T) {
				f := newCountdownRouterFixture(t)
				oldBody := customSlugBody(key, legacy.row)
				if legacy.path == "/api/v1/short-link/batch-create" {
					oldBody = `{"requestId":"` + key + `","targetUrls":[` + legacy.row + `]}`
				}
				newBody := customSlugBody(key, countdownRow)
				firstPath, firstBody, secondPath, secondBody := legacy.path, oldBody, countdownEndpoint, newBody
				expectedDelay := int16(5)
				if newFirst {
					firstPath, firstBody, secondPath, secondBody = countdownEndpoint, newBody, legacy.path, oldBody
					expectedDelay = 3
				}
				code, count := f.post(firstPath, firstBody, metadataRouterActor, true)
				require.Zero(t, code)
				require.Equal(t, 1, count)
				var delay int16
				require.NoError(t, f.pool.QueryRow(t.Context(), `select intermediate_delay_seconds from short_link where target_url='https://example.org/delay77'`).Scan(&delay))
				require.Equal(t, expectedDelay, delay)
				before := redirectModeSnapshot(t, f)
				code, _ = f.post(secondPath, secondBody, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}
