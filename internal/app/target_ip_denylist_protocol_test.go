package app

import (
	"context"
	"encoding/json"
	"fmt"
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

// TestAppIPDenylistStrictUpdate catches partial commands, lost microsecond CAS,
// stale no-ops, identity leaks and accidental changes to the four DNS DTOs.
func TestAppIPDenylistStrictUpdate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `update system_setting set updated_at='2026-11-13T00:00:00.123456Z' where key='security.target_ip_denylist'`)
	require.NoError(t, err)
	const initial = "2026-11-13T00:00:00.123456Z"
	valid := fmt.Sprintf(`{"addresses":["2001:0DB8::1"," ::ffff:203.0.113.9 "],"expectedUpdatedAt":%q}`, initial)
	saved := homeContentCall(t, a, cookie, "POST", targetIPDenylistPath+"/update", valid, 200, 0)
	require.Equal(t, []any{"2001:db8::1", "203.0.113.9"}, saved["addresses"])
	require.NotEqual(t, initial, saved["updatedAt"])
	for _, body := range []string{
		"", "null", "[]", `{}`, `{"addresses":[]}`, `{"addresses":null,"expectedUpdatedAt":"x"}`,
		`{"addresses":[],"expectedUpdatedAt":null}`, `{"addresses":[null],"expectedUpdatedAt":"x"}`,
		`{"addresses":[],"addresses":[],"expectedUpdatedAt":"x"}`,
		`{"addresses":[],"expectedUpdatedAt":"x","extra":1}`, valid + " {}", valid + strings.Repeat(" ", 32768),
		strings.Replace(valid, `2001:0DB8::1`, `2001:db8::1\n`, 1),
		strings.Replace(valid, `2001:0DB8::1`, `203.0.113.9`, 1),
		strings.Replace(valid, initial, "2026-11-13T00:00:00.1234567Z", 1),
	} {
		homeContentCall(t, a, cookie, "POST", targetIPDenylistPath+"/update", body, 200, 900220)
	}
	noOp := fmt.Sprintf(`{"addresses":["203.0.113.9","2001:db8::1"],"expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", targetIPDenylistPath+"/update", noOp, 200, 0))
	homeContentCall(t, a, cookie, "POST", targetIPDenylistPath+"/update", strings.Replace(noOp, saved["updatedAt"].(string), initial, 1), 200, 900221)
	var count int
	var fields string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*),min(changed_fields::text) from audit_log where resource_id='security.target_ip_denylist'`).Scan(&count, &fields))
	require.Equal(t, 1, count)
	require.Equal(t, "{security.target_ip_denylist}", fields)
	for _, path := range []string{
		"/api/v1/system/public-config", "/api/v1/admin/system/settings",
		"/api/v1/admin/system/target-host-denylist", "/api/v1/admin/system/target-host-allowlist",
		"/api/v1/admin/system/target-host-suffix-denylist", "/api/v1/admin/system/target-host-suffix-allowlist",
	} {
		require.NotContains(t, homeContentCall(t, a, cookie, "GET", path, "", 200, 0), "addresses")
	}
}

// TestIPPolicySevenWriteProtocols catches a bypass in any create/edit path,
// partial batches, revoked users recovering a receipt and changed retry payloads.
func TestIPPolicySevenWriteProtocols(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://203.0.113.9/original"}`, 200, 0)["shortLink"].(map[string]any)
	require.Equal(t, "https://203.0.113.9/original", created["targetUrl"])
	for i, tc := range []struct{ path, body string }{
		{"batch-create", `"targetUrls":["https://safe.example/1","https://203.0.113.9/2"]`},
		{"batch-create-with-titles", `"items":[{"targetUrl":"https://safe.example/3","title":"A"},{"targetUrl":"https://203.0.113.9/4","title":"B"}]`},
		{"batch-create-with-metadata", `"items":[{"targetUrl":"https://safe.example/5","title":"A","tags":[]},{"targetUrl":"https://203.0.113.9/6","title":"B","tags":[]}]`},
		{"batch-create-with-custom-slugs", `"items":[{"targetUrl":"https://safe.example/7","title":"A","tags":[],"customSlug":"ip69a"},{"targetUrl":"https://203.0.113.9/8","title":"B","tags":[],"customSlug":"ip69b"}]`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			key := fmt.Sprintf("69000000-0000-4000-8000-%012d", i+1)
			body := fmt.Sprintf(`{"requestId":%q,%s}`, key, tc.body)
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"addresses":[]}' where key='security.target_ip_denylist'`)
			require.NoError(t, err)
			first := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist'`)
			require.NoError(t, err)
			require.Equal(t, first, homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0))
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, strings.Replace(body, "safe.example", "changed.example", 1), 200, 200120)
			var links, audits, receipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			newKey := fmt.Sprintf("69000000-0000-4000-8000-%012d", i+101)
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
	for _, target := range []string{"https://203.0.113.9/new", "https://[::ffff:203.0.113.9]:8443/new"} {
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":%q}`, target), 200, 200121)
	}
	for _, path := range []string{"/api/v1/short-link/update", "/api/v1/admin/short-link/update"} {
		_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"addresses":null}' where key='security.target_ip_denylist'`)
		require.NoError(t, err)
		for _, fields := range []map[string]any{
			{"id": created["id"], "targetUrl": created["targetUrl"], "status": "active"},
			{"id": created["id"], "status": "active"},
		} {
			body, err := json.Marshal(fields)
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, string(body), 200, 0)
		}
		_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist'`)
		require.NoError(t, err)
		for _, tc := range []struct {
			target string
			code   int
		}{
			{"https://203.0.113.9/changed", 200121}, {"https://[::ffff:cb00:7109]/changed", 200121}, {"https://safe.example/changed", 0},
		} {
			body, err := json.Marshal(map[string]any{"id": created["id"], "targetUrl": tc.target})
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", path, string(body), 200, tc.code)
		}
		_, err = a.pool.Exec(t.Context(), `update short_link set target_url='https://203.0.113.9/original' where id=$1`, created["id"])
		require.NoError(t, err)
	}
}

// TestAppIPPolicyDNSCombinations catches altering the four existing DNS rules or
// allowing an early IP/DNS denial to conceal corruption in the fifth resource.
func TestAppIPPolicyDNSCombinations(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, enabled := range []struct{ exact, suffix bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		t.Run(fmt.Sprintf("exact=%t/suffix=%t", enabled.exact, enabled.suffix), func(t *testing.T) {
			_, err := a.pool.Exec(t.Context(), fmt.Sprintf(`update system_setting set value='{"enabled":%t,"hosts":["exact.example"]}' where key='security.target_host_allowlist';
				update system_setting set value='{"enabled":%t,"suffixes":["family.example"]}' where key='security.target_host_suffix_allowlist';
				update system_setting set value='{"hosts":["bad.family.example"]}' where key='security.target_host_denylist';
				update system_setting set value='{"suffixes":["blocked.family.example"]}' where key='security.target_host_suffix_denylist';
				update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist'`, enabled.exact, enabled.suffix))
			require.NoError(t, err)
			for _, tc := range []struct {
				target  string
				allowed bool
			}{
				{"https://exact.example/a", enabled.exact || !enabled.suffix},
				{"https://deep.family.example/a", enabled.suffix || !enabled.exact},
				{"https://unlisted.example/a", !enabled.exact && !enabled.suffix},
				{"https://192.0.2.1/a", !enabled.exact && !enabled.suffix},
				{"https://203.0.113.9/a", false}, {"https://[::ffff:203.0.113.9]/a", false},
				{"https://bad.family.example/a", false}, {"https://deep.blocked.family.example/a", false},
			} {
				code := 200121
				if tc.allowed {
					code = 0
				}
				homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":%q}`, tc.target), 200, code)
			}
		})
	}
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"addresses":null}' where key='security.target_ip_denylist'`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://bad.family.example/a"}`, 500, 900000)
}

// TestAppIPPolicyStartupFailure catches serving an absent or corrupt IP policy.
func TestAppIPPolicyStartupFailure(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing=%t", missing), func(t *testing.T) {
			databaseURL := testdb.ProjectMigratedDatabaseURL(t.Context(), t)
			pool, err := appdb.OpenPool(t.Context(), databaseURL)
			require.NoError(t, err)
			query := `update system_setting set value='{"addresses":["2001:DB8::1"]}' where key='security.target_ip_denylist'`
			if missing {
				query = `delete from system_setting where key='security.target_ip_denylist'`
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
