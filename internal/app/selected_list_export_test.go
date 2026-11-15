package app

import (
	"encoding/csv"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestSelectedListExportAPI catches missing routes, ignored selection and accidental private data disclosure.
func TestSelectedListExportAPI(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actor string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actor))
	for _, fixture := range []struct{ id, slug, created string }{
		{"00000000-0000-0000-0000-00000000e501", "selectedold", "2026-11-01T00:00:00Z"},
		{"00000000-0000-0000-0000-00000000e502", "selectednew", "2026-11-02T00:00:00Z"},
		{"00000000-0000-0000-0000-00000000e503", "notselected", "2026-11-03T00:00:00Z"},
	} {
		_, err := a.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,title,status,note,created_at,updated_at)
			select $1,$2,d.id,$3,'https://example.com/selected','current server title','active','private-selected-canary',$4::timestamptz,now()
			from domain d where d.is_default`, fixture.id, actor, fixture.slug, fixture.created)
		require.NoError(t, err)
	}
	var eventsBefore, auditBefore int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link_event`).Scan(&eventsBefore))
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&auditBefore))
	for _, prefix := range []string{"/api/v1/short-link", "/api/v1/admin/short-link"} {
		t.Run(prefix, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, prefix+"/export/selected", strings.NewReader(`{"ids":["00000000-0000-0000-0000-00000000e501","00000000-0000-0000-0000-00000000e502"]}`))
			r.Header.Set("Content-Type", "application/json")
			r.Header.Set("X-MoeURL-Expected-User-ID", actor)
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			require.Equal(t, http.StatusOK, w.Code, w.Body.String())
			var response struct {
				Code int `json:"code"`
				Data struct {
					FileName    string `json:"fileName"`
					ContentType string `json:"contentType"`
					Content     string `json:"content"`
				} `json:"data"`
			}
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
			require.Zero(t, response.Code, w.Body.String())
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			name := "moeurl-links-own-selected.csv"
			if strings.Contains(prefix, "/admin/") {
				name = "moeurl-links-all-selected.csv"
			}
			require.Equal(t, name, response.Data.FileName)
			require.Equal(t, "text/csv;charset=utf-8", response.Data.ContentType)
			require.True(t, strings.HasPrefix(response.Data.Content, "\ufeffid,short_url,"))
			require.True(t, strings.HasSuffix(response.Data.Content, "\r\n"))
			records, err := csv.NewReader(strings.NewReader(strings.TrimPrefix(response.Data.Content, "\ufeff"))).ReadAll()
			require.NoError(t, err)
			require.Len(t, records, 3)
			require.Equal(t, []string{"id", "short_url", "slug", "target_url", "title", "tags", "status", "redirect_mode", "intermediate_delay_seconds", "expires_at", "password_enabled", "max_visits", "visits_used", "created_at", "updated_at", "owner_id", "owner_username"}, records[0])
			require.Equal(t, "selectednew", records[1][2])
			require.Equal(t, "selectedold", records[2][2])
			require.Equal(t, "current server title", records[1][4])
			require.NotContains(t, response.Data.Content, "notselected")
			require.NotContains(t, response.Data.Content, "private-selected-canary")
		})
	}
	var eventsAfter, auditAfter int
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from short_link_event`).Scan(&eventsAfter))
	require.NoError(t, a.pool.QueryRow(t.Context(), `select count(*) from audit_log`).Scan(&auditAfter))
	require.Equal(t, eventsBefore, eventsAfter)
	require.Equal(t, auditBefore, auditAfter)
}

// TestSelectedListExportStrictAPI catches coerced selections and ambiguous request or actor framing.
func TestSelectedListExportStrictAPI(t *testing.T) {
	a := newTestApplication(t)
	cookie := domainOrderLogin(t, a)
	var actor string
	require.NoError(t, a.pool.QueryRow(t.Context(), `select id::text from app_user where username='admin'`).Scan(&actor))
	_, err := a.pool.Exec(t.Context(), `insert into short_link(id,owner_id,domain_id,slug,target_url,status,created_at,updated_at)
		select '00000000-0000-0000-0000-00000000e511',$1,d.id,'selectedstrict','https://example.com','active',now(),now() from domain d where d.is_default`, actor)
	require.NoError(t, err)
	valid := `{"ids":["00000000-0000-0000-0000-00000000e511"]}`
	for _, tc := range []struct {
		name, body, media, suffix string
		header                    []string
		code                      int
	}{
		{"valid-with-header", valid, "application/json", "", []string{actor}, 0},
		{"valid-no-optional-header", valid, "application/json", "", nil, 0},
		{"mime-parameters", valid, "application/json; charset=utf-8", "", nil, 0},
		{"body-exact-limit", valid + strings.Repeat(" ", 16384-len(valid)), "application/json", "", nil, 0},
		{"body-over-limit", valid + strings.Repeat(" ", 16385-len(valid)), "application/json", "", nil, 100001},
		{"empty", "", "application/json", "", nil, 100001},
		{"missing", `{}`, "application/json", "", nil, 100001},
		{"null-object", `null`, "application/json", "", nil, 100001},
		{"array-object", `[]`, "application/json", "", nil, 100001},
		{"null-ids", `{"ids":null}`, "application/json", "", nil, 100001},
		{"empty-ids", `{"ids":[]}`, "application/json", "", nil, 100001},
		{"scalar-ids", `{"ids":"00000000-0000-0000-0000-00000000e511"}`, "application/json", "", nil, 100001},
		{"null-id", `{"ids":[null]}`, "application/json", "", nil, 100001},
		{"number-id", `{"ids":[1]}`, "application/json", "", nil, 100001},
		{"object-id", `{"ids":[{}]}`, "application/json", "", nil, 100001},
		{"uppercase", strings.ReplaceAll(valid, "e511", "E511"), "application/json", "", nil, 100001},
		{"zero", `{"ids":["00000000-0000-0000-0000-000000000000"]}`, "application/json", "", nil, 100001},
		{"unhyphenated", `{"ids":["0000000000000000000000000000e511"]}`, "application/json", "", nil, 100001},
		{"whitespace-id", strings.ReplaceAll(valid, "00000000-0000-0000-0000-00000000e511", " 00000000-0000-0000-0000-00000000e511"), "application/json", "", nil, 100001},
		{"duplicate-id", `{"ids":["00000000-0000-0000-0000-00000000e511","00000000-0000-0000-0000-00000000e511"]}`, "application/json", "", nil, 100001},
		{"duplicate-key", strings.TrimSuffix(valid, "}") + `,"ids":[]}`, "application/json", "", nil, 100001},
		{"escaped-duplicate-key", strings.TrimSuffix(valid, "}") + `,"\u0069ds":[]}`, "application/json", "", nil, 100001},
		{"unknown-key", strings.TrimSuffix(valid, "}") + `,"owner":"x"}`, "application/json", "", nil, 100001},
		{"unknown-case", strings.Replace(valid, "ids", "IDs", 1), "application/json", "", nil, 100001},
		{"high-surrogate", `{"ids":["\ud800"]}`, "application/json", "", nil, 100001},
		{"low-surrogate", `{"ids":["\udfff"]}`, "application/json", "", nil, 100001},
		{"replacement-character", `{"ids":["\ufffd"]}`, "application/json", "", nil, 100001},
		{"invalid-utf8", "{\"ids\":[\"" + string([]byte{255}) + "\"]}", "application/json", "", nil, 100001},
		{"trailing-value", valid + `{}`, "application/json", "", nil, 100001},
		{"trailing-garbage", valid + `x`, "application/json", "", nil, 100001},
		{"missing-close", strings.TrimSuffix(valid, "}"), "application/json", "", nil, 100001},
		{"invalid-key-token", `{1:[]}`, "application/json", "", nil, 100001},
		{"no-content-type", valid, "", "", nil, 100001},
		{"wrong-content-type", valid, "text/plain", "", nil, 100001},
		{"invalid-content-type", valid, "application/json; broken", "", nil, 100001},
		{"query", valid, "application/json", "?ids=x", nil, 100001},
		{"bare-query", valid, "application/json", "?", nil, 100001},
		{"wrong-actor", valid, "application/json", "", []string{"00000000-0000-0000-0000-00000000e599"}, 120001},
		{"empty-actor", valid, "application/json", "", []string{""}, 120001},
		{"duplicate-actor", valid, "application/json", "", []string{actor, actor}, 120001},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequestWithContext(t.Context(), http.MethodPost, "/api/v1/short-link/export/selected"+tc.suffix, strings.NewReader(tc.body))
			if tc.media != "" {
				r.Header.Set("Content-Type", tc.media)
			}
			if tc.header != nil {
				r.Header["X-Moeurl-Expected-User-Id"] = tc.header
			}
			r.AddCookie(cookie)
			w := httptest.NewRecorder()
			a.server.Handler.ServeHTTP(w, r)
			var result struct {
				Code int             `json:"code"`
				Data json.RawMessage `json:"data"`
			}
			require.Equal(t, http.StatusOK, w.Code)
			require.NoError(t, json.Unmarshal(w.Body.Bytes(), &result))
			require.Equal(t, tc.code, result.Code, w.Body.String())
			require.Equal(t, "no-store", w.Header().Get("Cache-Control"))
			if tc.code != 0 {
				require.JSONEq(t, `null`, string(result.Data))
			}
		})
	}
}
