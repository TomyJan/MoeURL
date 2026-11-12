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

const targetSuffixPath = "/api/v1/admin/system/target-host-suffix-denylist"

// TestAppTargetHostSuffixMatchingAndPrecedence catches suffix denial being
// bypassed through IDNA, subdomains, or an overlapping exact allowlist entry.
func TestAppTargetHostSuffixMatchingAndPrecedence(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetSuffixPath, "", 200, 0)
	body := fmt.Sprintf(`{"suffixes":["xn--bcher-kva.example","blocked.example"],"expectedUpdatedAt":%q}`, current["updatedAt"])
	homeContentCall(t, a, cookie, "POST", targetSuffixPath+"/update", body, 200, 0)
	for _, tc := range []struct {
		target string
		code   int
	}{
		{"https://blocked.example/a", 200121},
		{"https://a.b.blocked.example:8443/a?q=1", 200121},
		{"https://BLOCKED.EXAMPLE./a", 200121},
		{"https://bücher。example/a", 200121},
		{"https://sub.xn--bcher-kva.example/a", 200121},
		{"https://notblocked.example/a", 0},
		{"https://blocked.example.evil.test/a", 0},
	} {
		body, err := json.Marshal(map[string]string{"targetUrl": tc.target})
		require.NoError(t, err)
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", string(body), 200, tc.code)
	}
	_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"hosts":["a.blocked.example","good.example"]}' where key='security.target_host_allowlist'; update system_setting set value='{"hosts":["good.example"]}' where key='security.target_host_denylist'`)
	require.NoError(t, err)
	for _, target := range []string{"https://a.blocked.example/overlap", "https://good.example/overlap"} {
		homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":%q}`, target), 200, 200121)
	}
}

// TestAppTargetHostSuffixHistoricalPublicAccess catches new write policy leaking
// into historical open/preview/unlock/continue, even if its storage later breaks.
func TestAppTargetHostSuffixHistoricalPublicAccess(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, mode := range []string{"direct", "intermediate", "confirmation"} {
		t.Run(mode, func(t *testing.T) {
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"suffixes":[]}' where key='security.target_host_suffix_denylist'`)
			require.NoError(t, err)
			created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":"https://deep.blocked.example/original","redirectMode":%q,"password":{"mode":"set","value":"suffix-public-password"}}`, mode), 200, 0)["shortLink"].(map[string]any)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"suffixes":["blocked.example"]}' where key='security.target_host_suffix_denylist'`)
			require.NoError(t, err)
			call := func(method, path, body string, grant *http.Cookie) *httptest.ResponseRecorder {
				t.Helper()
				r := httptest.NewRequestWithContext(t.Context(), method, path, strings.NewReader(body))
				r.Header.Set("Content-Type", "application/json")
				if grant != nil {
					r.AddCookie(grant)
				}
				w := httptest.NewRecorder()
				a.server.Handler.ServeHTTP(w, r)
				return w
			}
			open := call("GET", created["url"].(string), "", nil)
			require.Equal(t, 302, open.Code)
			base := "https://go.example.com/go/" + created["slug"].(string)
			unlock := call("POST", base+"/unlock", `{"password":"suffix-public-password"}`, nil)
			require.Equal(t, 200, unlock.Code)
			var unlocked struct{ Code int }
			require.NoError(t, json.Unmarshal(unlock.Body.Bytes(), &unlocked))
			require.Zero(t, unlocked.Code)
			cookies := unlock.Result().Cookies()
			require.Len(t, cookies, 1)
			for _, corrupt := range []bool{false, true} {
				if corrupt {
					_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"suffixes":null}' where key='security.target_host_suffix_denylist'`)
					require.NoError(t, err)
				}
				preview := call("GET", base+"/preview", "", cookies[0])
				require.Equal(t, 200, preview.Code)
				var envelope struct{ Code int }
				require.NoError(t, json.Unmarshal(preview.Body.Bytes(), &envelope))
				require.Zero(t, envelope.Code)
				continued := call("GET", base+"/continue", "", cookies[0])
				require.Equal(t, 302, continued.Code)
				require.Equal(t, "https://deep.blocked.example/original", continued.Header().Get("Location"))
			}
		})
	}
}

// TestAppTargetHostSuffixDenylistDefault catches a missing independent resource
// or a nonempty default that would restrict previously accepted targets.
func TestAppTargetHostSuffixDenylistDefault(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	current := homeContentCall(t, a, cookie, "GET", targetSuffixPath, "", 200, 0)
	require.Equal(t, []any{}, current["suffixes"])
	require.NotEmpty(t, current["updatedAt"])
	require.Len(t, current, 2)
}

// TestAppTargetHostSuffixWriteEntrypoints catches policy being ignored by the
// real creator, including accidental link, success audit, or receipt writes.
func TestAppTargetHostSuffixWriteEntrypoints(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.target_host_suffix_denylist','{"suffixes":["blocked.example"]}',now(),now())
		on conflict(key) do update set value=excluded.value`)
	require.NoError(t, err)
	var links, audits, receipts int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select
		(select count(*) from short_link),
		(select count(*) from audit_log),
		(select count(*) from short_link_create_batch)`).Scan(&links, &audits, &receipts))
	homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", `{"targetUrl":"https://a.blocked.example/new"}`, 200, 200121)
	var linksAfter, auditsAfter, receiptsAfter int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select
		(select count(*) from short_link),
		(select count(*) from audit_log),
		(select count(*) from short_link_create_batch)`).Scan(&linksAfter, &auditsAfter, &receiptsAfter))
	require.Equal(t, []int{links, audits, receipts}, []int{linksAfter, auditsAfter, receiptsAfter})
}

// TestAppTargetHostSuffixStrictUpdate catches an absent replacement command,
// partial/coerced settings, stale no-op acceptance, and leaking values in audit.
func TestAppTargetHostSuffixStrictUpdate(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `insert into system_setting(key,value,created_at,updated_at)
		values('security.target_host_suffix_denylist','{"suffixes":[]}',now(),'2026-11-12T00:00:00.123456Z')
		on conflict(key) do update set value=excluded.value,updated_at=excluded.updated_at`)
	require.NoError(t, err)
	const initialVersion = "2026-11-12T00:00:00.123456Z"
	valid := fmt.Sprintf(`{"suffixes":[" Z.example. ","a.example"],"expectedUpdatedAt":%q}`, initialVersion)
	saved := homeContentCall(t, a, cookie, "POST", targetSuffixPath+"/update", valid, 200, 0)
	require.Len(t, saved, 2)
	require.Equal(t, []any{"a.example", "z.example"}, saved["suffixes"])
	require.NotEqual(t, initialVersion, saved["updatedAt"])
	for _, body := range []string{
		"", "null", "[]", `{}`, `{"suffixes":[]}`,
		`{"enabled":null,"suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":"false","suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"enabled":0,"suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"suffixes":null,"expectedUpdatedAt":"x"}`,
		`{"suffixes":[],"expectedUpdatedAt":null}`,
		`{"enabled":true,"suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"suffixes":[],"suffixes":[],"expectedUpdatedAt":"x"}`,
		`{"suffixes":[],"expectedUpdatedAt":"x","extra":1}`,
		valid + " {}", valid + strings.Repeat(" ", 32768),
		strings.Replace(valid, `" Z.example. "`, `"z.example\n"`, 1),
		strings.Replace(valid, `" Z.example. "`, `"a.example"`, 1),
	} {
		homeContentCall(t, a, cookie, "POST", targetSuffixPath+"/update", body, 200, 900216)
	}
	noOp := fmt.Sprintf(`{"suffixes":["z.example","a.example"],"expectedUpdatedAt":%q}`, saved["updatedAt"])
	require.Equal(t, saved, homeContentCall(t, a, cookie, "POST", targetSuffixPath+"/update", noOp, 200, 0))
	stale := fmt.Sprintf(`{"suffixes":["a.example","z.example"],"expectedUpdatedAt":%q}`, initialVersion)
	homeContentCall(t, a, cookie, "POST", targetSuffixPath+"/update", stale, 200, 900217)
	var count int
	var fields string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*),min(changed_fields::text)
		from audit_log where resource_id='security.target_host_suffix_denylist'`).Scan(&count, &fields))
	require.Equal(t, 1, count)
	require.Equal(t, "{security.target_host_suffix_denylist}", fields)
	legacy := homeContentCall(t, a, cookie, "GET", "/api/v1/admin/system/settings", "", 200, 0)
	require.NotContains(t, legacy, "suffixes")
}

// TestAppTargetHostSuffixEditsAndBatchAtomicity catches partial batches, policy before
// committed receipt/authorization, and restriction of historical public links.
func TestAppTargetHostSuffixEditsAndBatchAtomicity(t *testing.T) {
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
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"suffixes":[]}' where key='security.target_host_suffix_denylist'`)
			require.NoError(t, err)
			first := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/"+tc.path, body, 200, 0)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"suffixes":["outside.example"]}' where key='security.target_host_suffix_denylist'`)
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

// TestAppTargetHostSuffixStartupFailure catches serving after a missing or disabled-but-
// corrupt allowlist instead of failing closed before HTTP startup.
func TestAppTargetHostSuffixStartupFailure(t *testing.T) {
	for _, missing := range []bool{false, true} {
		t.Run(fmt.Sprintf("missing=%t", missing), func(t *testing.T) {
			databaseURL := testdb.ProjectMigratedDatabaseURL(t.Context(), t)
			pool, err := appdb.OpenPool(t.Context(), databaseURL)
			require.NoError(t, err)
			query := `update system_setting set value='{"suffixes":["UPPER.example"]}' where key='security.target_host_suffix_denylist'`
			if missing {
				query = `delete from system_setting where key='security.target_host_suffix_denylist'`
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
