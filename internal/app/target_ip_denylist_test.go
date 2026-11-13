package app

import (
	"testing"

	"github.com/stretchr/testify/require"
)

const targetIPDenylistPath = "/api/v1/admin/system/target-ip-denylist"

// Missing production registration must fail this real authenticated GET.
func TestTargetIPDenylistHTTP(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetIPDenylistPath, "", 200, 0)
	require.Equal(t, []any{}, current["addresses"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 2)
}

// Ignoring the fifth stored policy incorrectly permits this real create.
func TestTargetIPDenylistAppliesToNewTargets(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values ('security.target_ip_denylist','{"addresses":["203.0.113.9"]}',now(),clock_timestamp())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://203.0.113.9/path"}`, 200, 200121)
}

// Base address restrictions apply to mapped IPv4 independently of the configured denylist.
func TestTargetIPDenylistPreservesMappedBaseRestrictions(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, settings := range []string{`{"addresses":[]}`, `{"addresses":["203.0.113.9"]}`} {
		_, err := a.pool.Exec(t.Context(), `update system_setting set value=$1 where key='security.target_ip_denylist'`, settings)
		require.NoError(t, err)
		for _, body := range []string{
			`{"targetUrl":"https://[::ffff:100.64.0.1]/"}`,
			`{"targetUrl":"https://[::ffff:0.0.0.0]/"}`,
			`{"targetUrl":"https://[::ffff:0.1.2.3]/"}`,
		} {
			homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", body, 200, 200103)
		}
	}
	var count int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link`).Scan(&count))
	require.Zero(t, count)
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://[::ffff:203.0.113.20]/"}`, 200, 0)
}
