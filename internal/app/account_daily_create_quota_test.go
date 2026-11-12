package app

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/stretchr/testify/require"
)

const accountDailyCreateQuotaPath = "/api/v1/admin/system/account-daily-create-quota"

// TestAppAccountDailyCreateQuotaDefault catches a missing independent resource
// or an upgrade that silently limits previously authorized accounts.
func TestAppAccountDailyCreateQuotaDefault(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", accountDailyCreateQuotaPath, "", 200, 0)
	require.Contains(t, current, "dailyLimit")
	require.Nil(t, current["dailyLimit"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 2)
}

// TestAppAccountDailyCreateQuotaUpdate catches a missing complete replacement,
// coercion, stale no-op acceptance, or an audit that leaks the configured value.
func TestAppAccountDailyCreateQuotaUpdate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.account_daily_create_quota','{"dailyLimit":null}',now(),'2026-11-12T00:00:00.123456Z')
		on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`)
	require.NoError(t, err)
	const revision = "2026-11-12T00:00:00.123456Z"
	saved := homeContentCall(t, a, cookie, "POST", accountDailyCreateQuotaPath+"/update", fmt.Sprintf(`{"dailyLimit":2,"expectedUpdatedAt":%q}`, revision), 200, 0)
	require.Equal(t, float64(2), saved["dailyLimit"])
	require.NotEqual(t, revision, saved["updatedAt"])
	for _, body := range []string{
		"", "null", "[]", `{}`, `{"dailyLimit":0}`, `{"expectedUpdatedAt":"x"}`,
		`{"dailyLimit":"2","expectedUpdatedAt":"x"}`, `{"dailyLimit":true,"expectedUpdatedAt":"x"}`,
		`{"dailyLimit":-1,"expectedUpdatedAt":"x"}`, `{"dailyLimit":1000001,"expectedUpdatedAt":"x"}`,
		`{"dailyLimit":1.0,"expectedUpdatedAt":"x"}`, `{"dailyLimit":1e2,"expectedUpdatedAt":"x"}`,
		`{"dailyLimit":0,"dailyLimit":1,"expectedUpdatedAt":"x"}`, `{"dailyLimit":0,"expectedUpdatedAt":"x","other":1}`,
		`{"dailyLimit":0,"expectedUpdatedAt":null}`, `{"dailyLimit":0,"expectedUpdatedAt":"x","expectedUpdatedAt":"y"}`,
		`{"dailyLimit":0,"expectedUpdatedAt":"x"} {}`, `{"dailyLimit":0,"expectedUpdatedAt":"x"}` + strings.Repeat(" ", 4096),
	} {
		homeContentCall(t, a, cookie, "POST", accountDailyCreateQuotaPath+"/update", body, 200, 900214)
	}
	noOp := fmt.Sprintf(`{"dailyLimit":2,"expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", accountDailyCreateQuotaPath+"/update", noOp, 200, 0))
	homeContentCall(t, a, cookie, "POST", accountDailyCreateQuotaPath+"/update", fmt.Sprintf(`{"dailyLimit":2,"expectedUpdatedAt":%q}`, revision), 200, 900215)
	for _, limit := range []string{"0", "1000000", "null"} {
		saved = homeContentCall(t, a, cookie, "POST", accountDailyCreateQuotaPath+"/update", fmt.Sprintf(`{"dailyLimit":%s,"expectedUpdatedAt":%q}`, limit, saved["updatedAt"]), 200, 0)
	}
	var count int
	var fields string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*),min(changed_fields::text)
		from audit_log where resource_id='security.account_daily_create_quota'`).Scan(&count, &fields))
	require.Equal(t, 4, count)
	require.Equal(t, "{security.account_daily_create_quota}", fields)
	legacy := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/settings", "", 200, 0)
	require.NotContains(t, legacy, "dailyLimit")
}

// TestAppDailyCreateQuotaZeroRejectsCreate catches the real authenticated
// creation path ignoring the stored zero limit, including for administrators.
func TestAppDailyCreateQuotaZeroRejectsCreate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.account_daily_create_quota','{"dailyLimit":0}',now(),now())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://quota.example/new"}`, 200, 200122)
	var links int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&links))
	require.Zero(t, links)
}

// TestDailyCreateQuotaWriteProtocols catches quota omitted from any batch,
// partial creation, double charging receipts and replay before authorization.
func TestDailyCreateQuotaWriteProtocols(t *testing.T) {
	for _, tc := range []struct{ path, fields string }{
		{"batch-create", `"targetUrls":["https://quota.example/a","https://quota.example/b"]`},
		{"batch-create-with-titles", `"items":[{"targetUrl":"https://quota.example/a","title":"A"},{"targetUrl":"https://quota.example/b","title":"B"}]`},
		{"batch-create-with-metadata", `"items":[{"targetUrl":"https://quota.example/a","title":"A","tags":[]},{"targetUrl":"https://quota.example/b","title":"B","tags":[]}]`},
		{"batch-create-with-custom-slugs", `"items":[{"targetUrl":"https://quota.example/a","title":"A","tags":[],"customSlug":"quota64a"},{"targetUrl":"https://quota.example/b","title":"B","tags":[],"customSlug":"quota64b"}]`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			a := newTestApplication(t)
			cookie := domainOrderLogin(t, a)
			set := func(limit int) {
				_, err := a.pool.Exec(t.Context(), `update system_setting set value=jsonb_build_object('dailyLimit',$1::integer) where key='security.account_daily_create_quota'`, limit)
				require.NoError(t, err)
			}
			snapshot := func() string {
				var value string
				require.NoError(t, a.pool.QueryRow(t.Context(), `select jsonb_build_object('links',(select coalesce(jsonb_agg(to_jsonb(l) order by id),'[]') from short_link l),'audit',(select coalesce(jsonb_agg(to_jsonb(a) order by id),'[]') from audit_log a),'receipt',(select coalesce(jsonb_agg(to_jsonb(r) order by actor_id,request_id),'[]') from short_link_create_batch r),'usage',(select coalesce(jsonb_agg(to_jsonb(u) order by actor_id),'[]') from account_daily_create_usage u))::text`).Scan(&value))
				return value
			}
			key := uuid.NewString()
			body := fmt.Sprintf(`{"requestId":%q,%s}`, key, tc.fields)
			path := "/api/v1/short-link/" + tc.path
			set(1)
			before := snapshot()
			homeContentCall(t, a, cookie, "POST", path, body, 200, 200122)
			require.Equal(t, before, snapshot(), "oversized batch leaves no usage, links, receipt or audit")
			set(2)
			first := homeContentCall(t, a, cookie, "POST", path, body, 200, 0)
			require.Equal(t, float64(2), first["createdCount"])
			var used, links, receipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select sum(used) from account_daily_create_usage),(select count(*) from short_link),(select count(*) from short_link_create_batch)`).Scan(&used, &links, &receipts))
			require.Equal(t, []int{2, 2, 1}, []int{used, links, receipts})
			set(0)
			before = snapshot()
			require.Equal(t, first, homeContentCall(t, a, cookie, "POST", path, body, 200, 0))
			homeContentCall(t, a, cookie, "POST", path, strings.Replace(body, "quota.example/a", "quota.example/changed", 1), 200, 200120)
			homeContentCall(t, a, cookie, "POST", path, strings.Replace(body, key, uuid.NewString(), 1), 200, 200122)
			require.Equal(t, before, snapshot())
			_, err := a.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:create' where key='admin'`)
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, body, 200, 120001)
			require.Equal(t, before, snapshot())
		})
	}
}

// TestAppDailyCreateQuotaDoesNotRestrictExistingAccess catches creation policy
// accidentally being consulted by public redirects or two editing protocols.
func TestAppDailyCreateQuotaDoesNotRestrictExistingAccess(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://quota.example/original"}`, 200, 0)["shortLink"].(map[string]any)
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"dailyLimit":0}' where key='security.account_daily_create_quota'`)
	require.NoError(t, err)
	response := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, created["url"].(string), nil))
	require.Equal(t, http.StatusFound, response.Code)
	require.Equal(t, "https://quota.example/original", response.Header().Get("Location"))
	for _, path := range []string{"/api/v1/short-link/update", "/api/v1/admin/short-link/update"} {
		body := fmt.Sprintf(`{"id":%q,"targetUrl":"https://quota.example/changed"}`, created["id"])
		homeContentCall(t, a, cookie, "POST", path, body, 200, 0)
	}
	var used int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select sum(used) from account_daily_create_usage`).Scan(&used))
	require.Equal(t, 1, used)
}
