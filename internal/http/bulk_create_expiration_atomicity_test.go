package http_test

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/TomyJan/MoeURL/internal/auth"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

// TestBulkExpirationAtomicity catches partial rows, audit, quota or receipts when the last row fails.
func TestBulkExpirationAtomicity(t *testing.T) {
	for _, tc := range []struct{ name, setup, row string }{
		{"occupied", `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) select gen_random_uuid(),u.id,d.id,'occupied74','https://example.org/occupied','active',now(),now() from app_user u cross join domain d`, strings.Replace(expirationRow, `"customSlug":""`, `"customSlug":"Occupied74"`, 1)},
		{"quota", `update system_setting set value='{"dailyLimit":1}' where key='security.account_daily_create_quota'`, expirationRow},
		{"host rule", `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`, strings.Replace(expirationRow, "example.org", "blocked.example", 1)},
		{"suffix deny", `update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist'`, strings.Replace(expirationRow, "example.org", "sub.blocked.example", 1)},
		{"ip deny", `update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist'`, strings.Replace(expirationRow, "example.org", "203.0.113.9", 1)},
		{"cidr deny", `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`, strings.Replace(expirationRow, "example.org", "203.0.113.9", 1)},
		{"host allow", `update system_setting set value='{"enabled":true,"hosts":["example.org"]}' where key='security.target_host_allowlist'`, strings.Replace(expirationRow, "example.org", "blocked.example", 1)},
		{"suffix allow", `update system_setting set value='{"enabled":true,"suffixes":["example.org"]}' where key='security.target_host_suffix_allowlist'`, strings.Replace(expirationRow, "example.org", "blocked.example", 1)},
		{"cidr allow", `update system_setting set value='{"enabled":true,"hosts":["example.org"]}' where key='security.target_host_allowlist'; update system_setting set value='{"enabled":true,"prefixes":["192.0.2.0/24"]}' where key='security.target_cidr_allowlist'`, strings.Replace(expirationRow, "example.org", "203.0.113.9", 1)},
		{"receipt failure", `create function fail_mode_receipt() returns trigger language plpgsql as $$ begin raise exception 'owned receipt failure'; end $$; create trigger fail_mode_receipt before insert on short_link_create_batch for each row execute function fail_mode_receipt()`, expirationRow},
		{"audit failure", `create function fail_mode_audit() returns trigger language plpgsql as $$ begin raise exception 'owned audit failure'; end $$; create trigger fail_mode_audit before insert on audit_log for each row execute function fail_mode_audit()`, expirationRow},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newExpirationRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), tc.setup)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			first := strings.Replace(expirationRow, "expiration75", "first75", 1)
			var input shortlink.BatchCreateWithExpirationsInput
			require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), first+","+tc.row)), &input))
			result, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithExpirations(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
			require.Error(t, err)
			switch tc.name {
			case "occupied":
				require.ErrorIs(t, err, shortlink.ErrSlugConflict)
			case "quota":
				require.ErrorIs(t, err, shortlink.ErrCreateQuotaExhausted)
			case "receipt failure":
				require.ErrorContains(t, err, "owned receipt failure")
			case "audit failure":
				require.ErrorContains(t, err, "owned audit failure")
			default:
				require.ErrorIs(t, err, shortlink.ErrTargetDenied)
			}
			require.Zero(t, result)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}
