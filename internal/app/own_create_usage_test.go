package app

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAppOwnDailyCreateUsage catches missing production wiring or a read that
// invents usage instead of returning the current owner's read-only snapshot.
func TestAppOwnDailyCreateUsage(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	r := httptest.NewRequestWithContext(t.Context(), "GET", "https://links.example.test/api/v1/account/daily-create-usage", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	var result struct {
		Code int            `json:"code"`
		Data map[string]any `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, 0, result.Code, w.Body.String())
	var day string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select (clock_timestamp() at time zone 'UTC')::date::text`).Scan(&day))
	require.Equal(t, map[string]any{"usageDay": day, "used": "0", "dailyLimit": nil, "remaining": nil}, result.Data)
	var rows int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from account_daily_create_usage`).Scan(&rows))
	require.Zero(t, rows, "reading must not create a metering row")
}
