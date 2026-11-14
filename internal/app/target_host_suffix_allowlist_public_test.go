package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAppSuffixAllowlistHistoricalPublicAccess catches new write policy leaking
// into historical open/preview/unlock/continue, even if its storage later breaks.
func TestAppSuffixAllowlistHistoricalPublicAccess(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, mode := range []string{"direct", "intermediate", "confirmation"} {
		t.Run(mode, func(t *testing.T) {
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":false,"suffixes":[]}' where key='security.target_host_suffix_allowlist'`)
			require.NoError(t, err)
			created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":"https://deep.blocked.example/original","redirectMode":%q,"password":{"mode":"set","value":"suffix-public-password"}}`, mode), 200, 0)["shortLink"].(map[string]any)
			// Historical policy access is independent of clock corrections; password revision revocation has separate regressions.
			_, err = a.pool.Exec(t.Context(), `update short_link set password_updated_at=timestamptz '2000-01-01 00:00:00+00' where id=$1`, created["id"].(string))
			require.NoError(t, err)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":true,"suffixes":["allowed.example"]}' where key='security.target_host_suffix_allowlist'`)
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
					_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"enabled":false,"suffixes":null}' where key='security.target_host_suffix_allowlist'`)
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
