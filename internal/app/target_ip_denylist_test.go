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
