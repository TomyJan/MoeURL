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

const visitLimitEndpoint = "/api/v1/short-link/batch-create-with-visit-limits"
const visitLimitRow = `{"targetUrl":"https://example.org/cap76","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"","expiresAt":"","maxVisits":"1"}`

// newVisitLimitRouterFixture exercises actual sessions, permission storage and all seven production routes.
func newVisitLimitRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation","short_link:set_expiration","short_link:set_max_visits"]' where key='user'`)
	require.NoError(t, err)
	_, err = f.pool.Exec(t.Context(), `insert into user_group(id,key,name,permissions,builtin,created_at,updated_at) values ('00000000-0000-0000-0000-000000007504','guest','Guest','[]',true,now(),now())`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(f.pool, time.Hour).Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(f.pool, time.Hour), ShortLinkBatchCreate: svc, ShortLinkBatchCreateTitles: svc, ShortLinkBatchCreateMetadata: svc, ShortLinkBatchCreateCustomSlugs: svc, ShortLinkBatchCreateRedirectModes: svc, ShortLinkBatchCreateExpirations: svc, ShortLinkBatchCreateVisitLimits: svc})
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

// TestBulkVisitLimitProtocol rejects lossy caps, ambiguous objects and both batch size boundaries without writes.
func TestBulkVisitLimitProtocol(t *testing.T) {
	f := newVisitLimitRouterFixture(t)
	for _, value := range []string{"0", "01", "+1", "-1", " ", " 1", "1 ", "1\n", "1.0", "1e1", "１", "١", "2147483648", "99999999999"} {
		encoded, err := json.Marshal(value)
		require.NoError(t, err)
		row := strings.Replace(visitLimitRow, `"maxVisits":"1"`, `"maxVisits":`+string(encoded), 1)
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
		require.Equal(t, 100001, code, value)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, replacement := range []string{`"maxVisits":null`, `"maxVisits":1`, `"maxVisits":true`, `"maxVisits":[]`, `"maxVisits":{}`, `"maxVisits":"1","maxVisits":"2"`, `"unknown":"1"`} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), strings.Replace(visitLimitRow, `"maxVisits":"1"`, replacement, 1)), metadataRouterActor, true)
		require.Equal(t, 100001, code, replacement)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, invalid := range []string{
		strings.Replace(visitLimitRow, `,"maxVisits":"1"`, "", 1),
		strings.Replace(visitLimitRow, `" raw "`, `"\ud800"`, 1),
		strings.Replace(visitLimitRow, `" raw "`, "\""+string([]byte{0xff})+"\"", 1),
	} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), invalid), metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, n := range []int{0, 20, 21} {
		rows := make([]string, n)
		for i := range n {
			rows[i] = strings.Replace(visitLimitRow, "cap76", fmt.Sprintf("cap76-%d", i), 1)
		}
		before := redirectModeSnapshot(t, f)
		code, count := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), strings.Join(rows, ",")), metadataRouterActor, true)
		if n == 20 {
			require.Zero(t, code)
			require.Equal(t, 20, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, n := range []int{65536, 65537} {
		body := customSlugBody(uuid.NewString(), visitLimitRow)
		body += strings.Repeat(" ", n-len(body))
		before := redirectModeSnapshot(t, f)
		code, count := f.post(visitLimitEndpoint, body, metadataRouterActor, true)
		if n == 65536 {
			require.Zero(t, code)
			require.Equal(t, 1, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	for _, invalid := range []string{`null`, `[]`, `{}`, customSlugBody(uuid.NewString(), visitLimitRow) + `{}`, customSlugBody(uuid.NewString(), visitLimitRow+","+visitLimitRow), strings.Replace(customSlugBody(uuid.NewString(), visitLimitRow), `"items":`, `"items":[],"items":`, 1)} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(visitLimitEndpoint, invalid, metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, authenticated := range []bool{false, true} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), visitLimitRow), "stale", authenticated)
		require.Equal(t, 120001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
}

// TestBulkVisitLimitCurrentPermissionBeforeReplay protects receipts after revocation while leaving uncapped creation available.
func TestBulkVisitLimitCurrentPermissionBeforeReplay(t *testing.T) {
	f := newVisitLimitRouterFixture(t)
	body := customSlugBody(uuid.NewString(), visitLimitRow)
	code, _ := f.post(visitLimitEndpoint, body, metadataRouterActor, true)
	require.Zero(t, code)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:set_max_visits' where key='user'`)
	require.NoError(t, err)
	before := redirectModeSnapshot(t, f)
	for _, payload := range []string{body, customSlugBody(uuid.NewString(), visitLimitRow)} {
		code, _ = f.post(visitLimitEndpoint, payload, metadataRouterActor, true)
		require.Equal(t, 120001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	blank := strings.Replace(visitLimitRow, `"maxVisits":"1"`, `"maxVisits":""`, 1)
	code, count := f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), blank), metadataRouterActor, true)
	require.Zero(t, code)
	require.Equal(t, 1, count)
	for _, grant := range []string{permission.ShortLinkCreate, permission.DomainUseDefault, permission.ShortLinkSetMetadata, permission.ShortLinkCustomSlug} {
		_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='user'`, grant)
		require.NoError(t, err)
		before := redirectModeSnapshot(t, f)
		code, _ = f.post(visitLimitEndpoint, customSlugBody(uuid.NewString(), blank), metadataRouterActor, true)
		require.Equal(t, 120001, code, grant)
		require.Equal(t, before, redirectModeSnapshot(t, f))
		_, err = f.pool.Exec(t.Context(), `update user_group set permissions=permissions||jsonb_build_array($1::text) where key='user'`, grant)
		require.NoError(t, err)
	}
}

// TestBulkVisitLimitLockedRevocation observes a real actor-lock wait before withdrawing authority for new writes and replay.
func TestBulkVisitLimitLockedRevocation(t *testing.T) {
	for _, replay := range []bool{false, true} {
		for _, fault := range []string{
			`update user_group set permissions=permissions-'short_link:set_max_visits' where key='user'`,
			`update app_user set status='disabled' where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set deleted_at=now() where id='00000000-0000-0000-0000-000000005501'`,
			`update app_user set group_id=(select id from user_group where key='guest') where id='00000000-0000-0000-0000-000000005501'`,
		} {
			t.Run(fmt.Sprintf("replay=%t/%s", replay, fault), func(t *testing.T) {
				f := newVisitLimitRouterFixture(t)
				var input shortlink.BatchCreateWithVisitLimitsInput
				require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), visitLimitRow)), &input))
				svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
				actor := auth.CurrentUser{ID: metadataRouterActor}
				if replay {
					_, err := svc.BatchCreateWithVisitLimits(t.Context(), actor, input)
					require.NoError(t, err)
				}
				before := redirectModeSnapshot(t, f)
				tx, err := f.pool.Begin(t.Context())
				require.NoError(t, err)
				defer func() { _ = tx.Rollback(context.Background()) }()
				_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
				require.NoError(t, err)
				done := make(chan error, 1)
				go func() { _, err := svc.BatchCreateWithVisitLimits(t.Context(), actor, input); done <- err }()
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
					t.Fatal("revoked visit-limit write did not settle")
				}
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}

// TestBulkVisitLimitConcurrentReceipt requires one committed batch across competing identical keys or slugs.
func TestBulkVisitLimitConcurrentReceipt(t *testing.T) {
	for _, kind := range []string{"same key", "changed cap", "same slug"} {
		t.Run(kind, func(t *testing.T) {
			f := newVisitLimitRouterFixture(t)
			svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
			var first, second shortlink.BatchCreateWithVisitLimitsInput
			body := customSlugBody(uuid.NewString(), strings.Replace(visitLimitRow, `"customSlug":""`, `"customSlug":"Cap76"`, 1))
			require.NoError(t, json.Unmarshal([]byte(body), &first))
			require.NoError(t, json.Unmarshal([]byte(body), &second))
			if kind == "changed cap" {
				second.Items[0].MaxVisits = "2"
			}
			if kind == "same slug" {
				second.RequestID = uuid.NewString()
			}
			start, done := make(chan struct{}), make(chan error, 2)
			for _, input := range []shortlink.BatchCreateWithVisitLimitsInput{first, second} {
				go func() {
					<-start
					_, err := svc.BatchCreateWithVisitLimits(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
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
					t.Fatal("concurrent visit-limit writes did not settle")
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

// TestBulkVisitLimitAtomicity verifies complete stored state after failures in link, audit, receipt and quota writes.
func TestBulkVisitLimitAtomicity(t *testing.T) {
	for _, tc := range []struct{ name, setup string }{
		{"link", `create function fail_cap_link() returns trigger language plpgsql as $$ begin if NEW.target_url like '%last76' then raise exception 'owned last link failure'; end if; return NEW; end $$; create trigger fail_cap_link before insert on short_link for each row execute function fail_cap_link()`},
		{"audit", `create function fail_cap_audit() returns trigger language plpgsql as $$ begin raise exception 'owned audit failure'; end $$; create trigger fail_cap_audit before insert on audit_log for each row execute function fail_cap_audit()`},
		{"receipt", `create function fail_cap_receipt() returns trigger language plpgsql as $$ begin raise exception 'owned receipt failure'; end $$; create trigger fail_cap_receipt before insert on short_link_create_batch for each row execute function fail_cap_receipt()`},
		{"quota", `update system_setting set value='{"dailyLimit":1}' where key='security.account_daily_create_quota'`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newVisitLimitRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), tc.setup)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			var input shortlink.BatchCreateWithVisitLimitsInput
			require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), visitLimitRow+","+strings.Replace(visitLimitRow, "cap76", "last76", 1))), &input))
			result, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithVisitLimits(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
			require.Error(t, err)
			require.Zero(t, result)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkVisitLimitLegacyProtocols keeps legacy caps null and rejects cross-protocol reuse in both directions.
func TestBulkVisitLimitLegacyProtocols(t *testing.T) {
	const key = "11111111-1111-4111-8111-111111117607"
	legacyRows := []struct{ path, row string }{
		{"/api/v1/short-link/batch-create", `"https://example.org/cap76"`},
		{"/api/v1/short-link/batch-create-with-titles", `{"targetUrl":"https://example.org/cap76","title":" raw "}`},
		{metadataRouterEndpoint, `{"targetUrl":"https://example.org/cap76","title":" raw ","tags":[" tag "]}`},
		{"/api/v1/short-link/batch-create-with-custom-slugs", `{"targetUrl":"https://example.org/cap76","title":" raw ","tags":[" tag "],"customSlug":""}`},
		{"/api/v1/short-link/batch-create-with-redirect-modes", `{"targetUrl":"https://example.org/cap76","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":""}`},
		{expirationEndpoint, strings.Replace(visitLimitRow, `,"maxVisits":"1"`, "", 1)},
	}
	for _, legacy := range legacyRows {
		for _, newFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/newFirst=%t", legacy.path, newFirst), func(t *testing.T) {
				f := newVisitLimitRouterFixture(t)
				oldBody := customSlugBody(key, legacy.row)
				if legacy.path == "/api/v1/short-link/batch-create" {
					oldBody = `{"requestId":"` + key + `","targetUrls":[` + legacy.row + `]}`
				}
				newBody := customSlugBody(key, visitLimitRow)
				firstPath, firstBody, secondPath, secondBody := legacy.path, oldBody, visitLimitEndpoint, newBody
				if newFirst {
					firstPath, firstBody, secondPath, secondBody = visitLimitEndpoint, newBody, legacy.path, oldBody
				}
				code, count := f.post(firstPath, firstBody, metadataRouterActor, true)
				require.Zero(t, code)
				require.Equal(t, 1, count)
				var capIsNull bool
				require.NoError(t, f.pool.QueryRow(t.Context(), `select max_visits is null from short_link where target_url='https://example.org/cap76'`).Scan(&capIsNull))
				require.Equal(t, !newFirst, capIsNull)
				before := redirectModeSnapshot(t, f)
				code, _ = f.post(secondPath, secondBody, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}
