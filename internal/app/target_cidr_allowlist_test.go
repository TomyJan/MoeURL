package app

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
)

const targetCIDRAllowlistPath = "/api/v1/admin/system/target-cidr-allowlist"

// A missing production route must fail a real current-authorized resource read.
func TestTargetCIDRAllowlistHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetCIDRAllowlistPath, "", 200, 0)
	require.Equal(t, false, current["enabled"])
	require.Equal(t, []any{}, current["prefixes"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 3)
}

// Ignoring the seventh policy would allow an unmatched new literal target.
func TestTargetCIDRAllowlistRestrictsNewTargets(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values ('security.target_cidr_allowlist','{"enabled":true,"prefixes":["203.0.113.0/24"]}',now(),clock_timestamp())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	var links, audits, receipts int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://198.51.100.1/path"}`, 200, 200121)
	var afterLinks, afterAudits, afterReceipts int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch)`).Scan(&afterLinks, &afterAudits, &afterReceipts))
	require.Equal(t, []int{links, audits, receipts}, []int{afterLinks, afterAudits, afterReceipts})
}

// Treating the three enabled allow resources as an intersection rejects IPs
// even when their network is explicitly allowed alongside a DNS host.
func TestTargetCIDRAllowlistUnionsWithDNS(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values ('security.target_cidr_allowlist','{"enabled":true,"prefixes":["203.0.113.0/24"]}',now(),clock_timestamp())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["allowed.example"]}' where key='security.target_host_allowlist'`)
	require.NoError(t, err)
	body, err := json.Marshal(map[string]string{"targetUrl": "https://203.0.113.9/path"})
	require.NoError(t, err)
	created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", string(body), 200, 0)
	require.NotEmpty(t, created["shortLink"].(map[string]any)["slug"])
}

// An allow hit, including /0, must never exempt the target from base validation
// or any of the four independently configured deny resources.
func TestTargetCIDRAllowlistDenialsAndBaseRestrictions(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"prefixes":["0.0.0.0/0","::/0"]}' where key='security.target_cidr_allowlist';
		update system_setting set value='{"enabled":true,"hosts":["blocked.example"]}' where key='security.target_host_allowlist';
		update system_setting set value='{"enabled":true,"suffixes":["family.example"]}' where key='security.target_host_suffix_allowlist';
		update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist';
		update system_setting set value='{"suffixes":["blocked.family.example"]}' where key='security.target_host_suffix_denylist';
		update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist';
		update system_setting set value='{"prefixes":["198.51.100.0/24"]}' where key='security.target_cidr_denylist'`)
	require.NoError(t, err)
	for _, target := range []string{"https://blocked.example/", "https://deep.blocked.family.example/", "https://203.0.113.9/", "https://[::ffff:203.0.113.9]/", "https://198.51.100.1/"} {
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"`+target+`"}`, 200, 200121)
	}
	for _, target := range []string{"https://[::ffff:100.64.0.1]/", "https://[::ffff:0.0.0.0]/", "https://0.1.2.3/", "https://127.0.0.1/", "https://[::1]/"} {
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"`+target+`"}`, 200, 200103)
	}
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
	require.Zero(t, count)
	_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":false,"prefixes":null}' where key='security.target_cidr_allowlist'`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://blocked.example/"}`, 500, 900000)
}
