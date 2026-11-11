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

const targetPolicyPath = "/api/v1/admin/system/target-host-denylist"

// TestAppTargetHostDenylistCASAndStrictInput catches silent partial commands,
// stale no-ops, leaked values in audit, and widening the legacy settings DTO.
func TestAppTargetHostDenylistCASAndStrictInput(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetPolicyPath, "", 200, 0)
	version := current["updatedAt"]
	valid := fmt.Sprintf(`{"hosts":[" Z.example. ","a.example"],"expectedUpdatedAt":%q}`, version)
	for _, body := range []string{"", "null", "[]", `{"hosts":[]}`, `{"hosts":null,"expectedUpdatedAt":"x"}`, `{"hosts":[],"expectedUpdatedAt":null}`, `{"hosts":[],"hosts":[],"expectedUpdatedAt":"x"}`, `{"hosts":[],"expectedUpdatedAt":"x","extra":1}`, valid + " {}", valid + strings.Repeat(" ", 32768), strings.Replace(valid, `" Z.example. "`, `"Z.example\n"`, 1), strings.Replace(valid, `" Z.example. "`, `"a.example"`, 1)} {
		homeContentCall(t, a, cookie, "POST", targetPolicyPath+"/update", body, 200, 900210)
	}
	saved := homeContentCall(t, a, cookie, "POST", targetPolicyPath+"/update", valid, 200, 0)
	require.Equal(t, []any{"a.example", "z.example"}, saved["hosts"])
	require.NotEqual(t, version, saved["updatedAt"])
	body := fmt.Sprintf(`{"hosts":["z.example","a.example"],"expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", targetPolicyPath+"/update", body, 200, 0))
	body = fmt.Sprintf(`{"hosts":["a.example","z.example"],"expectedUpdatedAt":%q}`, version)
	homeContentCall(t, a, cookie, "POST", targetPolicyPath+"/update", body, 200, 900211)
	var count int
	var fields string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*),min(changed_fields::text) from audit_log where resource_id='security.target_host_denylist'`).Scan(&count, &fields))
	require.Equal(t, 1, count)
	require.Equal(t, "{security.target_host_denylist}", fields)
	legacy := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/settings", "", 200, 0)
	require.NotContains(t, legacy, "hosts")
	public := homeContentCall(t, a, nil, "GET", "/api/v1/system/public-config", "", 200, 0)
	require.NotContains(t, public, "hosts")
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"hosts":["UPPER.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "GET", targetPolicyPath, "", 500, 900000)
}

// TestAppTargetHostDenylistEditsAndBatchAtomicity catches partial writes, altered
// receipt recovery, and blocking historical links or unchanged target bytes.
func TestAppTargetHostDenylistEditsAndBatchAtomicity(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://blocked.example/original"}`, 200, 0)["shortLink"].(map[string]any)
	for i, tc := range []struct{ path, body string }{
		{"batch-create", `"targetUrls":["https://safe.example/1","https://blocked.example/2"]`},
		{"batch-create-with-titles", `"items":[{"targetUrl":"https://safe.example/3","title":"A"},{"targetUrl":"https://blocked.example/4","title":"B"}]`},
		{"batch-create-with-metadata", `"items":[{"targetUrl":"https://safe.example/5","title":"A","tags":[]},{"targetUrl":"https://blocked.example/6","title":"B","tags":[]}]`},
		{"batch-create-with-custom-slugs", `"items":[{"targetUrl":"https://safe.example/7","title":"A","tags":[],"customSlug":"target61a"},{"targetUrl":"https://blocked.example/8","title":"B","tags":[],"customSlug":"target61b"}]`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			key := fmt.Sprintf("61000000-0000-4000-8000-%012d", i+1)
			body := fmt.Sprintf(`{"requestId":%q,%s}`, key, tc.body)
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"hosts":[]}' where key='security.target_host_denylist'`)
			require.NoError(t, err)
			first := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`)
			require.NoError(t, err)
			require.Equal(t, first, homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0), "committed receipt before new policy")
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, strings.Replace(body, "safe.example", "other.example", 1), 200, 200120)
			var links, audits, receipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			newKey := fmt.Sprintf("61000000-0000-4000-8000-%012d", i+101)
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, strings.Replace(body, key, newKey, 1), 200, 200121)
			var l2, a2, r2 int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&l2, &a2, &r2))
			require.Equal(t, []int{links, audits, receipts}, []int{l2, a2, r2})
			var grants string
			require.NoError(t, a.pool.QueryRow(t.Context(), `select permissions::text from user_group where key='admin'`).Scan(&grants))
			restoreGrants := func() {
				ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_, restoreErr := a.pool.Exec(ctx, `update user_group set permissions=$1::jsonb where key='admin'`, grants)
				require.NoError(t, restoreErr)
				var restored string
				require.NoError(t, a.pool.QueryRow(ctx, `select permissions::text from user_group where key='admin'`).Scan(&restored))
				require.JSONEq(t, grants, restored)
			}
			t.Cleanup(restoreGrants)
			_, err = a.pool.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:create' where key='admin'`)
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 120001)
			restoreGrants()
		})
	}
	oldResponse := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(oldResponse, httptest.NewRequestWithContext(t.Context(), http.MethodGet, created["url"].(string), nil))
	require.Equal(t, http.StatusFound, oldResponse.Code)
	require.Equal(t, "https://blocked.example/original", oldResponse.Header().Get("Location"))
	for _, path := range []string{"/api/v1/short-link/update", "/api/v1/admin/short-link/update"} {
		body, _ := json.Marshal(map[string]any{"id": created["id"], "targetUrl": created["targetUrl"], "status": "active"})
		homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0)
		body, _ = json.Marshal(map[string]any{"id": created["id"], "status": "active"})
		homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0)
		body, _ = json.Marshal(map[string]any{"id": created["id"], "targetUrl": "https://blocked.example/changed"})
		homeContentCall(t, a, cookie, "POST", path, string(body), 200, 200121)
	}
}

// TestAppTargetPolicyStartupFailure catches startup ignoring a missing/corrupt
// policy and serving an unintended allow-all configuration.
func TestAppTargetPolicyStartupFailure(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing=%t", missing), func(t *testing.T) {
			databaseURL := testdb.ProjectMigratedDatabaseURL(t.Context(), t)
			pool, err := appdb.OpenPool(t.Context(), databaseURL)
			require.NoError(t, err)
			query := `update system_setting set value='{"hosts":["UPPER.example"]}' where key='security.target_host_denylist'`
			if missing {
				query = `delete from system_setting where key='security.target_host_denylist'`
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

// TestAppTargetHostDenylistResource catches a missing independent management
// resource; it exercises the real application, session and PostgreSQL store.
func TestAppTargetHostDenylistResource(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/target-host-denylist", "", 200, 0)
	require.Equal(t, []any{}, current["hosts"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 2)
}

// TestAppTargetHostDenylistEnforcesCreate catches a policy stored successfully
// but ignored by the existing authenticated single-create path.
func TestAppTargetHostDenylistEnforcesCreate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.target_host_denylist','{"hosts":["blocked.example"]}',now(),now())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	var before int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&before))
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://blocked.example/a"}`, 200, 200121)
	var after int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&after))
	require.Equal(t, before, after)
}
