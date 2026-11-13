package app

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

const targetCIDRDenylistPath = "/api/v1/admin/system/target-cidr-denylist"

// Missing production registration must fail a real current-authorized read.
func TestTargetCIDRDenylistHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetCIDRDenylistPath, "", 200, 0)
	require.Equal(t, []any{}, current["prefixes"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 2)
}

// Ignoring the sixth stored policy permits writes inside a configured network.
func TestTargetCIDRDenylistAppliesToNewTargets(t *testing.T) {
	for _, tc := range []struct {
		name   string
		target string
	}{
		{"IPv4 network member", "https://203.0.113.129/path"},
		{"mapped IPv4 network member", "https://[::ffff:203.0.113.17]/path"},
		{"native IPv6 network member", "https://[2001:db8:70:ffff::1]/path"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestApplication(t)
			cookie := domainOrderLogin(t, a)
			_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
				values ('security.target_cidr_denylist','{"prefixes":["2001:db8:70::/48","203.0.113.0/24"]}',now(),clock_timestamp())
				on conflict(key) do update set value=excluded.value`)
			require.NoError(t, err)
			var links, audits, receipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
			body, err := json.Marshal(map[string]string{"targetUrl": tc.target})
			require.NoError(t, err)
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", string(body), 200, 200121)
			var afterLinks, afterAudits, afterReceipts int
			require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&afterLinks, &afterAudits, &afterReceipts))
			require.Equal(t, []int{links, audits, receipts}, []int{afterLinks, afterAudits, afterReceipts})
		})
	}
}

// An enabled broad rule must not replace the caller's original invalid-target
// result for base-restricted addresses with the configurable policy error.
func TestTargetCIDRDenylistPreservesBaseRestrictions(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"prefixes":["0.0.0.0/0","::/0"]}' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	for _, target := range []string{"https://[::ffff:100.64.0.1]/", "https://[::ffff:0.0.0.0]/", "https://0.1.2.3/"} {
		body, err := json.Marshal(map[string]string{"targetUrl": target})
		require.NoError(t, err)
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", string(body), 200, 200103)
	}
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
	require.Zero(t, count)
}
