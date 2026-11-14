package http_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/TomyJan/MoeURL/internal/permission"
	"github.com/TomyJan/MoeURL/internal/shortlink"
	"github.com/google/uuid"
	"github.com/stretchr/testify/require"
)

const redirectModeEndpoint = "/api/v1/short-link/batch-create-with-redirect-modes"
const redirectModeRow = `{"targetUrl":"https://example.org/mode74","title":" raw ","tags":[" tag "],"customSlug":"","redirectMode":"intermediate"}`

// newRedirectModeRouterFixture retains real storage and identity while exposing all five protocols.
func newRedirectModeRouterFixture(t *testing.T) metadataRouterFixture {
	t.Helper()
	f := newMetadataRouterFixture(t)
	_, err := f.pool.Exec(t.Context(), `update user_group set permissions='["short_link:create","domain:use_default","short_link:set_metadata","short_link:custom_slug","short_link:use_intermediate","short_link:use_confirmation"]' where key='user'`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(f.pool, time.Hour).Create(t.Context(), metadataRouterActor)
	require.NoError(t, err)
	svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(f.pool, time.Hour), ShortLinkBatchCreate: svc, ShortLinkBatchCreateTitles: svc, ShortLinkBatchCreateMetadata: svc, ShortLinkBatchCreateCustomSlugs: svc, ShortLinkBatchCreateRedirectModes: svc})
	f.post = func(path, payload, expected string, authenticated bool) (int, int) {
		t.Helper()
		r := httptest.NewRequestWithContext(t.Context(), "POST", path, strings.NewReader(payload))
		r.Header.Set("Content-Type", "application/json")
		if expected != "" {
			r.Header.Set("X-MoeURL-Expected-User-ID", expected)
		}
		if authenticated {
			r.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		require.Equal(t, 200, w.Code, w.Body.String())
		require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
		var body struct {
			Code int `json:"code"`
			Data struct {
				CreatedCount int `json:"createdCount"`
			} `json:"data"`
		}
		require.NoError(t, json.Unmarshal(w.Body.Bytes(), &body))
		return body.Code, body.Data.CreatedCount
	}
	return f
}

// redirectModeSnapshot includes complete rows and quota, rather than relying only on counts.
func redirectModeSnapshot(t *testing.T, f metadataRouterFixture) string {
	t.Helper()
	var snapshot string
	require.NoError(t, f.pool.QueryRow(t.Context(), `select jsonb_build_object(
 'links',(select jsonb_agg(to_jsonb(x) order by id) from short_link x),
 'events',(select jsonb_agg(to_jsonb(x) order by id) from short_link_event x),
 'audit',(select jsonb_agg(to_jsonb(x) order by id) from audit_log x),
 'receipts',(select jsonb_agg(to_jsonb(x) order by actor_id,request_id) from short_link_create_batch x),
 'quota',(select jsonb_agg(to_jsonb(x) order by actor_id) from account_daily_create_usage x))::text`).Scan(&snapshot))
	return snapshot
}

// TestBulkRedirectModeProtocol covers bounded strict production routing and all three stored modes.
func TestBulkRedirectModeProtocol(t *testing.T) {
	f := newRedirectModeRouterFixture(t)
	for _, mode := range []string{"", "direct", "intermediate", "confirmation"} {
		row := strings.Replace(redirectModeRow, `"intermediate"`, `"`+mode+`"`, 1)
		code, count := f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), row), metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 1, count)
	}
	for _, invalid := range []string{
		strings.Replace(redirectModeRow, `,"redirectMode":"intermediate"`, "", 1),
		strings.Replace(redirectModeRow, `"intermediate"`, `null`, 1),
		strings.Replace(redirectModeRow, `"intermediate"`, `"INTERMEDIATE"`, 1),
		strings.Replace(redirectModeRow, `"intermediate"`, `" direct"`, 1),
		strings.Replace(redirectModeRow, `"redirectMode":`, `"redirectMode":"direct","redirectMode":`, 1),
		strings.Replace(redirectModeRow, `"redirectMode":`, `"delay":7,"redirectMode":`, 1),
	} {
		before := redirectModeSnapshot(t, f)
		code, _ := f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), invalid), metadataRouterActor, true)
		require.Equal(t, 100001, code)
		require.Equal(t, before, redirectModeSnapshot(t, f))
	}
	for _, n := range []int{0, 20, 21} {
		rows := make([]string, n)
		for i := range n {
			rows[i] = strings.Replace(redirectModeRow, "mode74", fmt.Sprintf("mode74-%d", i), 1)
		}
		before := redirectModeSnapshot(t, f)
		code, count := f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), strings.Join(rows, ",")), metadataRouterActor, true)
		if n == 20 {
			require.Zero(t, code)
			require.Equal(t, 20, count)
		} else {
			require.Equal(t, 100001, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
	}
	code, _ := f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), redirectModeRow), "stale", true)
	require.Equal(t, 120001, code)
	code, _ = f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), redirectModeRow), "", false)
	require.Equal(t, 120001, code)
}

// TestBulkRedirectModeReplay catches duplicate quota, normalized digests, row reordering and cross-protocol replay.
func TestBulkRedirectModeReplay(t *testing.T) {
	t.Run("raw digest and order", func(t *testing.T) {
		f := newRedirectModeRouterFixture(t)
		row := strings.Replace(redirectModeRow, `"intermediate"`, `""`, 1)
		second := strings.Replace(redirectModeRow, "mode74", "other74", 1)
		key := uuid.NewString()
		body := customSlugBody(key, row+","+second)
		code, _ := f.post(redirectModeEndpoint, body, metadataRouterActor, true)
		require.Zero(t, code)
		before := redirectModeSnapshot(t, f)
		code, count := f.post(redirectModeEndpoint, body, metadataRouterActor, true)
		require.Zero(t, code)
		require.Equal(t, 2, count)
		require.Equal(t, before, redirectModeSnapshot(t, f))
		for _, changed := range []string{strings.Replace(body, `"redirectMode":""`, `"redirectMode":"direct"`, 1), customSlugBody(key, second+","+row), strings.Replace(body, " raw ", "raw", 1)} {
			code, _ = f.post(redirectModeEndpoint, changed, metadataRouterActor, true)
			require.Equal(t, 200120, code)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		}
		var digest string
		require.NoError(t, f.pool.QueryRow(t.Context(), `select encode(request_hash,'hex') from short_link_create_batch where request_id=$1::uuid`, key).Scan(&digest))
		var wire shortlink.BatchCreateWithRedirectModesInput
		require.NoError(t, json.Unmarshal([]byte(body), &wire))
		encoded, err := json.Marshal(wire.Items)
		require.NoError(t, err)
		expected := sha256.Sum256(append([]byte("moeurl:bulk-create:redirect-modes:v1:"), encoded...))
		require.Equal(t, hex.EncodeToString(expected[:]), digest)
	})
	for _, old := range []struct{ name, path, row string }{
		{"targets", "/api/v1/short-link/batch-create", ""},
		{"titles", "/api/v1/short-link/batch-create-with-titles", `{"targetUrl":"https://example.org/old","title":""}`},
		{"metadata", metadataRouterEndpoint, `{"targetUrl":"https://example.org/old","title":"","tags":[]}`},
		{"custom", customSlugEndpoint, `{"targetUrl":"https://example.org/old","title":"","tags":[],"customSlug":""}`},
	} {
		for _, newFirst := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/newFirst=%t", old.name, newFirst), func(t *testing.T) {
				f := newRedirectModeRouterFixture(t)
				key := uuid.NewString()
				oldBody := customSlugBody(key, old.row)
				if old.name == "targets" {
					oldBody = `{"requestId":"` + key + `","targetUrls":["https://example.org/old"]}`
				}
				firstPath, firstBody, secondPath, secondBody := old.path, oldBody, redirectModeEndpoint, customSlugBody(key, redirectModeRow)
				if newFirst {
					firstPath, firstBody, secondPath, secondBody = secondPath, secondBody, firstPath, firstBody
				}
				code, _ := f.post(firstPath, firstBody, metadataRouterActor, true)
				require.Zero(t, code)
				before := redirectModeSnapshot(t, f)
				code, _ = f.post(secondPath, secondBody, metadataRouterActor, true)
				require.Equal(t, 200120, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			})
		}
	}
}

// TestBulkRedirectModeRevocation checks every required grant before both new writes and successful-receipt replay.
func TestBulkRedirectModeRevocation(t *testing.T) {
	for _, removed := range []string{"short_link:create", "domain:use_default", "short_link:set_metadata", "short_link:custom_slug", "short_link:use_intermediate", "short_link:use_confirmation"} {
		t.Run(removed, func(t *testing.T) {
			f := newRedirectModeRouterFixture(t)
			rows := redirectModeRow + "," + strings.Replace(strings.Replace(redirectModeRow, "mode74", "confirm74", 1), "intermediate", "confirmation", 1)
			body := customSlugBody(uuid.NewString(), rows)
			code, _ := f.post(redirectModeEndpoint, body, metadataRouterActor, true)
			require.Zero(t, code)
			_, err := f.pool.Exec(t.Context(), `update user_group set permissions=permissions-$1 where key='user'`, removed)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			for _, wire := range []string{body, customSlugBody(uuid.NewString(), rows)} {
				code, _ = f.post(redirectModeEndpoint, wire, metadataRouterActor, true)
				require.Equal(t, 120001, code)
				require.Equal(t, before, redirectModeSnapshot(t, f))
			}
			if strings.HasPrefix(removed, "short_link:use_") {
				code, _ = f.post(redirectModeEndpoint, customSlugBody(uuid.NewString(), strings.Replace(redirectModeRow, "intermediate", "direct", 1)), metadataRouterActor, true)
				require.Zero(t, code, "direct needs no unused mode grant")
			}
		})
	}
	for _, fault := range []string{`update app_user set status='disabled' where id=$1::uuid`, `update app_user set deleted_at=now() where id=$1::uuid`} {
		t.Run(fault, func(t *testing.T) {
			f := newRedirectModeRouterFixture(t)
			var input shortlink.BatchCreateWithRedirectModesInput
			require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), redirectModeRow)), &input))
			svc := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool))
			actor := auth.CurrentUser{ID: metadataRouterActor}
			_, err := svc.BatchCreateWithRedirectModes(t.Context(), actor, input)
			require.NoError(t, err)
			_, err = f.pool.Exec(t.Context(), fault, metadataRouterActor)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			result, err := svc.BatchCreateWithRedirectModes(t.Context(), actor, input)
			require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
			require.Zero(t, result)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkRedirectModeAtomicity catches partial rows, audit, quota or receipts when the last row fails.
func TestBulkRedirectModeAtomicity(t *testing.T) {
	for _, tc := range []struct{ name, setup, row string }{
		{"occupied", `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at) select gen_random_uuid(),u.id,d.id,'occupied74','https://example.org/occupied','active',now(),now() from app_user u cross join domain d`, strings.Replace(redirectModeRow, `"customSlug":""`, `"customSlug":"Occupied74"`, 1)},
		{"quota", `update system_setting set value='{"dailyLimit":1}' where key='security.account_daily_create_quota'`, redirectModeRow},
		{"host rule", `update system_setting set value='{"hosts":["blocked.example"]}' where key='security.target_host_denylist'`, strings.Replace(redirectModeRow, "example.org", "blocked.example", 1)},
		{"suffix deny", `update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist'`, strings.Replace(redirectModeRow, "example.org", "sub.blocked.example", 1)},
		{"ip deny", `update system_setting set value='{"addresses":["203.0.113.9"]}' where key='security.target_ip_denylist'`, strings.Replace(redirectModeRow, "example.org", "203.0.113.9", 1)},
		{"cidr deny", `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`, strings.Replace(redirectModeRow, "example.org", "203.0.113.9", 1)},
		{"host allow", `update system_setting set value='{"enabled":true,"hosts":["example.org"]}' where key='security.target_host_allowlist'`, strings.Replace(redirectModeRow, "example.org", "blocked.example", 1)},
		{"suffix allow", `update system_setting set value='{"enabled":true,"suffixes":["example.org"]}' where key='security.target_host_suffix_allowlist'`, strings.Replace(redirectModeRow, "example.org", "blocked.example", 1)},
		{"cidr allow", `update system_setting set value='{"enabled":true,"hosts":["example.org"]}' where key='security.target_host_allowlist'; update system_setting set value='{"enabled":true,"prefixes":["192.0.2.0/24"]}' where key='security.target_cidr_allowlist'`, strings.Replace(redirectModeRow, "example.org", "203.0.113.9", 1)},
		{"receipt failure", `create function fail_mode_receipt() returns trigger language plpgsql as $$ begin raise exception 'owned receipt failure'; end $$; create trigger fail_mode_receipt before insert on short_link_create_batch for each row execute function fail_mode_receipt()`, redirectModeRow},
		{"audit failure", `create function fail_mode_audit() returns trigger language plpgsql as $$ begin raise exception 'owned audit failure'; end $$; create trigger fail_mode_audit before insert on audit_log for each row execute function fail_mode_audit()`, redirectModeRow},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := newRedirectModeRouterFixture(t)
			_, err := f.pool.Exec(t.Context(), tc.setup)
			require.NoError(t, err)
			before := redirectModeSnapshot(t, f)
			first := strings.Replace(redirectModeRow, "mode74", "first74", 1)
			var input shortlink.BatchCreateWithRedirectModesInput
			require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), first+","+tc.row)), &input))
			result, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithRedirectModes(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
			require.Error(t, err)
			require.Zero(t, result)
			require.Equal(t, before, redirectModeSnapshot(t, f))
		})
	}
}

// TestBulkRedirectModeLockedRevocation waits for the actual actor lock before withdrawing a mode grant.
func TestBulkRedirectModeLockedRevocation(t *testing.T) {
	f := newRedirectModeRouterFixture(t)
	tx, err := f.pool.Begin(t.Context())
	require.NoError(t, err)
	defer func() { _ = tx.Rollback(context.Background()) }()
	_, err = tx.Exec(t.Context(), `select id from app_user where id=$1::uuid for update`, metadataRouterActor)
	require.NoError(t, err)
	var input shortlink.BatchCreateWithRedirectModesInput
	require.NoError(t, json.Unmarshal([]byte(customSlugBody(uuid.NewString(), redirectModeRow)), &input))
	done := make(chan error, 1)
	go func() {
		_, err := shortlink.NewService(f.pool, permission.NewDatabaseService(f.pool)).BatchCreateWithRedirectModes(t.Context(), auth.CurrentUser{ID: metadataRouterActor}, input)
		done <- err
	}()
	require.Eventually(t, func() bool {
		var waiting bool
		err := f.pool.QueryRow(t.Context(), `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '-- name: LockBulkCreateActor%')`).Scan(&waiting)
		return err == nil && waiting
	}, 3*time.Second, 5*time.Millisecond)
	_, err = tx.Exec(t.Context(), `update user_group set permissions=permissions-'short_link:use_intermediate' where key='user'`)
	require.NoError(t, err)
	require.NoError(t, tx.Commit(t.Context()))
	select {
	case err := <-done:
		require.ErrorIs(t, err, shortlink.ErrPermissionDenied)
	case <-time.After(7 * time.Second):
		t.Fatal("revoked write did not settle")
	}
	require.Equal(t, []int{0, 0, 0}, f.counts())
}
