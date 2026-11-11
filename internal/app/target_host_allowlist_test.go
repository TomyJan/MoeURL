package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/config"
	appdb "github.com/TomyJan/MoeURL/internal/db"
	"github.com/TomyJan/MoeURL/internal/targetpolicy"
	"github.com/TomyJan/MoeURL/internal/testdb"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

const targetAllowlistPath = "/api/v1/admin/system/target-host-allowlist"

// TestAppTargetHostAllowlistDefaultAndStrictUpdate catches a missing independent
// management resource or an enabled-by-default restriction on existing installs.
func TestAppTargetHostAllowlistDefaultAndStrictUpdate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetAllowlistPath, "", 200, 0)
	require.Equal(t, false, current["enabled"])
	require.Equal(t, []any{}, current["hosts"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 3)
}

// TestAppTargetHostAllowlistStrictUpdate catches an absent replacement command,
// partial/coerced settings, stale no-op acceptance, and leaking values in audit.
func TestAppTargetHostAllowlistStrictUpdate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.target_host_allowlist','{"enabled":false,"hosts":[]}',now(),'2026-11-12T00:00:00.123456Z')
		on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`)
	require.NoError(t, err)
	const initialVersion = "2026-11-12T00:00:00.123456Z"
	valid := fmt.Sprintf(`{"enabled":false,"hosts":[" Z.example. ","a.example"],"expectedUpdatedAt":%q}`, initialVersion)
	saved := homeContentCall(t, a, cookie, "POST", targetAllowlistPath+"/update", valid, 200, 0)
	require.Equal(t, false, saved["enabled"])
	require.Equal(t, []any{"a.example", "z.example"}, saved["hosts"])
	require.NotEqual(t, initialVersion, saved["updatedAt"])
	for _, body := range []string{
		"", "null", "[]", `{}`, `{"enabled":false,"hosts":[]}`,
		`{"enabled":null,"hosts":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":"false","hosts":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":0,"hosts":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":false,"hosts":null,"expectedUpdatedAt":"x"}`,
		`{"enabled":false,"hosts":[],"expectedUpdatedAt":null}`,
		`{"enabled":false,"enabled":true,"hosts":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":false,"hosts":[],"hosts":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":false,"hosts":[],"expectedUpdatedAt":"x","extra":1}`,
		valid + " {}", valid + strings.Repeat(" ", 32768),
		strings.Replace(valid, `" Z.example. "`, `"z.example\n"`, 1),
		strings.Replace(valid, `" Z.example. "`, `"a.example"`, 1),
	} {
		homeContentCall(t, a, cookie, "POST", targetAllowlistPath+"/update", body, 200, 900212)
	}
	noOp := fmt.Sprintf(`{"enabled":false,"hosts":["z.example","a.example"],"expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", targetAllowlistPath+"/update", noOp, 200, 0))
	stale := fmt.Sprintf(`{"enabled":false,"hosts":["a.example","z.example"],"expectedUpdatedAt":%q}`, initialVersion)
	homeContentCall(t, a, cookie, "POST", targetAllowlistPath+"/update", stale, 200, 900213)
	emptyEnabled := fmt.Sprintf(`{"enabled":true,"hosts":[],"expectedUpdatedAt":%q}`, saved["updatedAt"])
	homeContentCall(t, a, cookie, "POST", targetAllowlistPath+"/update", emptyEnabled, 200, 900212)
	var count int
	var fields string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*),min(changed_fields::text)
		from audit_log where resource_id='security.target_host_allowlist'`).Scan(&count, &fields))
	require.Equal(t, 1, count)
	require.Equal(t, "{security.target_host_allowlist}", fields)
	legacy := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/settings", "", 200, 0)
	require.NotContains(t, legacy, "hosts")
	require.NotContains(t, legacy, "enabled")
}

// TestTargetHostAllowlistWriteEntrypoints catches a persisted enabled policy
// being ignored by the real authenticated creation path, leaving partial state.
func TestTargetHostAllowlistWriteEntrypoints(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.target_host_allowlist','{"enabled":true,"hosts":["allowed.example"]}',now(),now())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	var links, audits, receipts int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select
		(select count(*) from short_link),
		(select count(*) from audit_log),
		(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://other.example/a"}`, 200, 200121)
	var linksAfter, auditsAfter, receiptsAfter int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select
		(select count(*) from short_link),
		(select count(*) from audit_log),
		(select count(*) from short_link_create_batch)`).Scan(&linksAfter, &auditsAfter, &receiptsAfter))
	require.Equal(t, []int{links, audits, receipts}, []int{linksAfter, auditsAfter, receiptsAfter})
}

// TestAppAllowlistEditsAndBatchAtomicity catches partial batches, policy before
// committed receipt/authorization, and restriction of historical public links.
func TestAppAllowlistEditsAndBatchAtomicity(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://outside.example/original"}`, 200, 0)["shortLink"].(map[string]any)
	for i, tc := range []struct{ path, body string }{
		{"batch-create", `"targetUrls":["https://allowed.example/1","https://outside.example/2"]`},
		{"batch-create-with-titles", `"items":[{"targetUrl":"https://allowed.example/3","title":"A"},{"targetUrl":"https://outside.example/4","title":"B"}]`},
		{"batch-create-with-metadata", `"items":[{"targetUrl":"https://allowed.example/5","title":"A","tags":[]},{"targetUrl":"https://outside.example/6","title":"B","tags":[]}]`},
		{"batch-create-with-custom-slugs", `"items":[{"targetUrl":"https://allowed.example/7","title":"A","tags":[],"customSlug":"target63a"},{"targetUrl":"https://outside.example/8","title":"B","tags":[],"customSlug":"target63b"}]`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			key := fmt.Sprintf("63000000-0000-4000-8000-%012d", i+1)
			body := fmt.Sprintf(`{"requestId":%q,%s}`, key, tc.body)
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["allowed.example","outside.example"]}' where key='security.target_host_allowlist'`)
			require.NoError(t, err)
			first := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["allowed.example"]}' where key='security.target_host_allowlist'`)
			require.NoError(t, err)
			require.Equal(t, first, homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0))
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, strings.Replace(body, "allowed.example", "changed.example", 1), 200, 200120)
			var links, audits, receipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			newKey := fmt.Sprintf("63000000-0000-4000-8000-%012d", i+101)
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, strings.Replace(body, key, newKey, 1), 200, 200121)
			var l2, a2, r2 int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&l2, &a2, &r2))
			require.Equal(t, []int{links, audits, receipts}, []int{l2, a2, r2})
			var grants string
			require.NoError(t, a.pool.QueryRow(t.Context(), `select permissions::text from user_group where key='admin'`).Scan(&grants))
			restore := func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, err := a.pool.Exec(ctx, `update user_group set permissions=$1::jsonb where key='admin'`, grants)
				require.NoError(t, err)
			}
			t.Cleanup(restore)
			_, err = a.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:create' where key='admin'`)
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 120001)
			restore()
		})
	}
	response := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(response, httptest.NewRequestWithContext(t.Context(), http.MethodGet, created["url"].(string), nil))
	require.Equal(t, http.StatusFound, response.Code)
	require.Equal(t, "https://outside.example/original", response.Header().Get("Location"))
	for _, path := range []string{"/api/v1/short-link/update", "/api/v1/admin/short-link/update"} {
		for _, fields := range []map[string]any{
			{"id": created["id"], "targetUrl": created["targetUrl"], "status": "active"},
			{"id": created["id"], "status": "active"},
		} {
			body, err := json.Marshal(fields)
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0)
		}
		body, err := json.Marshal(map[string]any{"id": created["id"], "targetUrl": "https://outside.example/changed"})
		require.NoError(t, err)
		homeContentCall(t, a, cookie, "POST", path, string(body), 200, 200121)
		body, err = json.Marshal(map[string]any{"id": created["id"], "targetUrl": "https://allowed.example/changed"})
		require.NoError(t, err)
		homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0)
		// Restore this historical target outside policy so both edit paths test it.
		_, err = a.pool.Exec(t.Context(), `update short_link set target_url='https://outside.example/original' where id=$1`, created["id"])
		require.NoError(t, err)
	}
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://allowed.example/new"}`, 200, 0)
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"hosts":["allowed.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://allowed.example/new"}`, 200, 200121)
}

// TestAppAllowlistStartupFailure catches serving after a missing or disabled-but-
// corrupt allowlist instead of failing closed before HTTP startup.
func TestAppAllowlistStartupFailure(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing=%t", missing), func(t *testing.T) {
			databaseURL := testdb.ProjectMigratedDatabaseURL(t.Context(), t)
			pool, err := appdb.OpenPool(t.Context(), databaseURL)
			require.NoError(t, err)
			query := `update system_setting set value='{"enabled":false,"hosts":["UPPER.example"]}' where key='security.target_host_allowlist'`
			if missing {
				query = `delete from system_setting where key='security.target_host_allowlist'`
			}
			_, err = pool.Exec(t.Context(), query)
			pool.Close()
			require.NoError(t, err)
			application, err := New(t.Context(), config.Config{Env: "development", HTTPAddr: ":0", DatabaseURL: databaseURL}, nil)
			if application != nil {
				t.Cleanup(func() {
					ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					defer cancel()
					require.NoError(t, application.Shutdown(ctx))
				})
			}
			require.Nil(t, application)
			if missing {
				require.ErrorIs(t, err, pgx.ErrNoRows)
			} else {
				require.ErrorIs(t, err, targetpolicy.ErrCorrupt)
			}
		})
	}
}
