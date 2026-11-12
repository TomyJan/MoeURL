package app

import (
	"encoding/csv"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// TestAppGlobalVisitExport catches missing production wiring, a single-owner
// restriction, or an export that silently omits deleted-link history.
func TestAppGlobalVisitExport(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	_, err := a.pool.Exec(t.Context(), `
		insert into app_user(id,username,nickname,group_id,status,builtin,created_at,updated_at)
		select '00000000-0000-0000-0000-000000066001','export-owner','Export Owner',id,'active',false,now(),now()
		from user_group where key='user';
		insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at,deleted_at)
		select '00000000-0000-0000-0000-000000066101',u.id,d.id,'globalexporta','https://secret.example/a','active',now(),now(),null
		from app_user u cross join domain d where u.username='admin' and d.is_default;
		insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at,deleted_at)
		select '00000000-0000-0000-0000-000000066102','00000000-0000-0000-0000-000000066001',d.id,'globalexportb','https://secret.example/b','active',now(),now(),now()
		from domain d where d.is_default;
		insert into short_link_event(id,short_link_id,event_type,created_at,referrer_host)
		values('00000000-0000-0000-0000-000000066201','00000000-0000-0000-0000-000000066101','redirect_response_sent',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC','=1'),
		('00000000-0000-0000-0000-000000066202','00000000-0000-0000-0000-000000066102','redirect_response_sent',date_trunc('day',now() at time zone 'UTC') at time zone 'UTC','snow.example');`)
	require.NoError(t, err)
	var day time.Time
	require.NoError(t, a.pool.QueryRow(t.Context(), `select date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`).Scan(&day))
	r := httptest.NewRequestWithContext(t.Context(), "GET", "https://links.example.test/api/v1/admin/dashboard/visits/export", nil)
	r.AddCookie(cookie)
	w := httptest.NewRecorder()
	a.server.Handler.ServeHTTP(w, r)
	require.Equal(t, 200, w.Code, w.Body.String())
	var result struct {
		Code int `json:"code"`
		Data struct {
			FileName    string `json:"fileName"`
			ContentType string `json:"contentType"`
			Content     string `json:"content"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
	require.Equal(t, 0, result.Code, w.Body.String())
	require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	require.Equal(t, "text/csv;charset=utf-8", result.Data.ContentType)
	require.Equal(t, "moeurl-site-visits-"+day.AddDate(0, 0, -6).Format(time.DateOnly)+"-"+day.Format(time.DateOnly)+".csv", result.Data.FileName)
	require.True(t, strings.HasPrefix(result.Data.Content, "\ufeff"))
	rows, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(result.Data.Content, "\ufeff"))).ReadAll()
	require.NoError(t, err)
	require.Len(t, rows, 3)
	require.Equal(t, []string{"short_link_id", "start_date", "end_date", "time_zone", "event_id", "occurred_at", "referrer_host", "device_type", "browser_family", "os_family", "country_code"}, rows[0])
	require.Equal(t, "00000000-0000-0000-0000-000000066102", rows[1][0])
	require.Equal(t, "00000000-0000-0000-0000-000000066101", rows[2][0])
	require.Equal(t, "'=1", rows[2][6])
	require.NotContains(t, result.Data.Content, "secret.example")
	require.NotContains(t, result.Data.Content, "export-owner")
}
