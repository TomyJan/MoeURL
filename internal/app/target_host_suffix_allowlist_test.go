package app

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
)

const targetSuffixAllowlistPath = "/api/v1/admin/system/target-host-suffix-allowlist"

// Removing registration must make the actual administrator GET fail.
func TestTargetHostSuffixAllowlistHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetSuffixAllowlistPath, "", 200, 0)
	require.Equal(t, false, current["enabled"])
	require.Equal(t, []any{}, current["suffixes"])
	require.NotEmpty(t, current["updatedAt"])
}

// Omitting the fourth policy in CheckTargets incorrectly permits this write.
func TestSuffixAllowlistAppliesToNewTargets(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at) values ('security.target_host_suffix_allowlist','{"enabled":true,"suffixes":["allowed.example"]}',now(),clock_timestamp()) on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":%q}`, "https://blocked.example/"), 200, 200121)
}

// An intersection, inactive-list authorization or reversed deny precedence
// changes these independently derived results through the real create route.
func TestSuffixAllowlistUnionAndPrecedence(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, enabled := range []struct{ exact, suffix bool }{{false, false}, {true, false}, {false, true}, {true, true}} {
		t.Run(fmt.Sprintf("exact=%t/suffix=%t", enabled.exact, enabled.suffix), func(t *testing.T) {
			_, err := a.pool.Exec(t.Context(), fmt.Sprintf(`update system_setting set value='{"enabled":%t,"hosts":["exact.example"]}' where key='security.target_host_allowlist';
				insert into system_setting(key,value,created_at,updated_at) values('security.target_host_suffix_allowlist','{"enabled":%t,"suffixes":["family.example","xn--bcher-kva.example"]}',now(),now()) on conflict(key) do update set value=excluded.value;
				update system_setting set value='{"hosts":["bad.family.example"]}' where key='security.target_host_denylist';
				update system_setting set value='{"suffixes":["blocked.family.example"]}' where key='security.target_host_suffix_denylist'`, enabled.exact, enabled.suffix))
			require.NoError(t, err)
			for _, tc := range []struct {
				target  string
				allowed bool
			}{
				{"https://exact.example/only-exact", enabled.exact || !enabled.suffix},
				{"https://family.example/itself", enabled.suffix || !enabled.exact},
				{"https://a.b.family.example:8443/only-suffix?q=1", enabled.suffix || !enabled.exact},
				{"https://BÜCHER。example./idna", enabled.suffix || !enabled.exact},
				{"https://notfamily.example/boundary", !enabled.exact && !enabled.suffix},
				{"https://family.example.evil.test/boundary", !enabled.exact && !enabled.suffix},
				{"https://8.8.8.8/ip", !enabled.exact && !enabled.suffix},
				{"https://[2001:4860:4860::8888]/ip", !enabled.exact && !enabled.suffix},
				{"https://bad.family.example/exact-deny", false},
				{"https://deep.blocked.family.example/suffix-deny", false},
			} {
				code := 200121
				if tc.allowed {
					code = 0
				}
				homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":%q}`, tc.target), 200, code)
			}
		})
	}
	// Even a matching denial cannot hide corrupt fourth-resource storage.
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":false,"suffixes":null}' where key='security.target_host_suffix_allowlist'`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://bad.family.example/corrupt"}`, 500, 900000)
}
