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

// TestCIDRPolicyHistoricalAccess catches applying new write policy to historical
// open/preview/unlock/continue, even after the stored new resource becomes corrupt.
func TestCIDRPolicyHistoricalAccess(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	for _, mode := range []string{"direct", "intermediate", "confirmation"} {
		t.Run(mode, func(t *testing.T) {
			_, err := a.pool.Exec(t.Context(), `update system_setting set value='{"prefixes":[]}' where key='security.target_cidr_denylist'`)
			require.NoError(t, err)
			created := homeContentCall(t, a, cookie, "POST", "/api/v1/short-link/create", fmt.Sprintf(`{"targetUrl":"https://203.0.113.9/original","redirectMode":%q,"password":{"mode":"set","value":"cidr-public-password"}}`, mode), 200, 0)["shortLink"].(map[string]any)
			_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"prefixes":["203.0.113.0/24"]}' where key='security.target_cidr_denylist'`)
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
			require.Equal(t, 302, call("GET", created["url"].(string), "", nil).Code)
			base := "https://go.example.com/go/" + created["slug"].(string)
			unlock := call("POST", base+"/unlock", `{"password":"cidr-public-password"}`, nil)
			require.Equal(t, 200, unlock.Code)
			var envelope struct{ Code int }
			require.NoError(t, json.Unmarshal(unlock.Body.Bytes(), &envelope))
			require.Zero(t, envelope.Code)
			cookies := unlock.Result().Cookies()
			require.Len(t, cookies, 1)
			for _, corrupt := range []bool{false, true} {
				if corrupt {
					_, err = a.pool.Exec(t.Context(), `update system_setting set value='{"prefixes":null}' where key='security.target_cidr_denylist'`)
					require.NoError(t, err)
				}
				preview := call("GET", base+"/preview", "", cookies[0])
				require.Equal(t, 200, preview.Code)
				require.NoError(t, json.Unmarshal(preview.Body.Bytes(), &envelope))
				require.Zero(t, envelope.Code)
				continued := call("GET", base+"/continue", "", cookies[0])
				require.Equal(t, 302, continued.Code)
				require.Equal(t, "https://203.0.113.9/original", continued.Header().Get("Location"))
			}
		})
	}
}
