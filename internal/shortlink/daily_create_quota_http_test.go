package shortlink_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/TomyJan/MoeURL/internal/auth"
	apphttp "github.com/TomyJan/MoeURL/internal/http"
	"github.com/stretchr/testify/require"
)

// TestDailyCreateQuotaHTTPResponses catches either real creation handler
// exposing an exhausted account as a generic server error or committing data.
func TestDailyCreateQuotaHTTPResponses(t *testing.T) {
	pool, service, actor := targetWriteFixture(t)
	_, err := pool.Exec(t.Context(), `update system_setting set value='{"dailyLimit":0}' where key='security.account_daily_create_quota'`)
	require.NoError(t, err)
	session, err := auth.NewSessionService(pool, time.Hour).Create(t.Context(), actor.ID)
	require.NoError(t, err)
	router := apphttp.NewRouter(apphttp.Dependencies{CurrentUser: auth.NewService(pool, time.Hour), ShortLink: service, ShortLinkBatchCreate: service})
	for _, tc := range []struct{ path, body string }{
		{"/api/v1/short-link/create", `{"targetUrl":"https://quota-http.example/private"}`},
		{"/api/v1/short-link/batch-create", `{"requestId":"8afed221-bffc-4a61-a93e-4f8e13cdf8d1","targetUrls":["https://quota-http.example/private"]}`},
	} {
		t.Run(tc.path, func(t *testing.T) {
			request := httptest.NewRequestWithContext(t.Context(), "POST", tc.path, strings.NewReader(tc.body))
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-MoeURL-Expected-User-ID", actor.ID)
			request.AddCookie(&http.Cookie{Name: auth.SessionCookieName, Value: session.ID})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			require.Equal(t, 200, response.Code)
			var body struct {
				Code int
				Data any
			}
			require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
			require.Equal(t, 200122, body.Code, response.Body.String())
			require.Nil(t, body.Data)
			require.NotContains(t, response.Body.String(), "quota-http.example")
			var links, audits, receipts, usage int
			require.NoError(t, pool.QueryRow(t.Context(), `select (select count(*) from short_link),(select count(*) from audit_log),(select count(*) from short_link_create_batch),(select count(*) from account_daily_create_usage)`).Scan(&links, &audits, &receipts, &usage))
			require.Equal(t, []int{0, 0, 0, 0}, []int{links, audits, receipts, usage})
		})
	}
}
